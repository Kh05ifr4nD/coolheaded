import type {
  HttpClient,
  HttpClientError,
  HttpResponse,
  JsonClient,
  JsonClientError,
  JsonResponse,
} from "coolheaded/core/httpClient.ts";
import {
  UpdateError,
  runUpdateScript,
  scriptPath,
  updateNewerPinVersion,
} from "coolheaded/core/updateScript.ts";
import { fetchHttpClient, fetchJsonClient } from "coolheaded/core/fetchHttpClient.ts";
import {
  hexSha256ToSRI,
  releaseHashConfig,
  releaseUrlsFromTargets,
} from "coolheaded/update/release.ts";
import { Effect } from "effect";
import type { PackageHashConfig } from "coolheaded/pin/packageHashConfig.ts";
import { systemRecord } from "coolheaded/system/target.ts";
import { writePackageHashConfig } from "coolheaded/pin/json.ts";

const PIN_FILE_PATH = scriptPath("pin.json", import.meta.url);
const RELEASE_BASE = "https://downloads.claude.ai/claude-code-releases";
const REQUEST_TIMEOUT_MS = 30_000;
const SHA256_HEX = /^[0-9a-f]{64}$/u;

const RELEASE_TARGETS = {
  "aarch64-darwin": "darwin-arm64",
  "aarch64-linux": "linux-arm64",
  "x86_64-linux": "linux-x64",
} as const satisfies Readonly<Record<SupportedSystem, string>>;

type SupportedSystem = Parameters<Parameters<typeof systemRecord>[0]>[0];
type PlatformChecksums = Readonly<Record<SupportedSystem, string>>;
type ReleaseHashError = Effect.Effect.Error<ReturnType<typeof releaseHashConfig>>;

interface UpdateDependencies {
  readonly httpClient: HttpClient;
  readonly jsonClient: JsonClient;
  readonly pinFilePath: string;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function httpRequest(url: string): Parameters<HttpClient["request"]>[0] {
  return {
    headers: {},
    method: "GET",
    timeoutMs: REQUEST_TIMEOUT_MS,
    url,
  };
}

function responseText<Response extends HttpResponse>(
  response: Response,
): Effect.Effect<string, UpdateError> & Readonly<{ readonly response?: Response }> {
  return Effect.try({
    catch: (): UpdateError => new UpdateError(`Invalid UTF-8 response from ${response.url}`),
    try: (): string => new globalThis.TextDecoder("utf8", { fatal: true }).decode(response.body),
  });
}

function latestVersion(
  httpClient: HttpClient,
): Effect.Effect<string, HttpClientError | UpdateError> {
  const url = `${RELEASE_BASE}/latest`;

  return Effect.flatMap(
    httpClient.request(httpRequest(url)),
    <Response extends HttpResponse>(
      response: Response,
    ): Effect.Effect<string, UpdateError> & Readonly<{ readonly response?: Response }> =>
      Effect.map(responseText(response), (text: string): string => text.trim()),
  );
}

function checksumForPlatform(
  platforms: Readonly<Record<string, unknown>>,
  platform: string,
): Effect.Effect<string, UpdateError> {
  const entry = platforms[platform];
  if (!isRecord(entry)) {
    return Effect.fail(new UpdateError(`Invalid Claude Code manifest platform: ${platform}`));
  }

  const { binary, checksum } = entry;
  if (binary !== "claude" || typeof checksum !== "string" || !SHA256_HEX.test(checksum)) {
    return Effect.fail(new UpdateError(`Invalid Claude Code checksum: ${platform}`));
  }

  return Effect.succeed(checksum);
}

function platformChecksums(
  value: unknown,
  version: string,
): Effect.Effect<PlatformChecksums, UpdateError> {
  if (!isRecord(value)) {
    return Effect.fail(new UpdateError(`Invalid Claude Code manifest for ${version}`));
  }

  const { platforms, version: manifestVersion } = value;
  if (manifestVersion !== version || !isRecord(platforms)) {
    return Effect.fail(new UpdateError(`Invalid Claude Code manifest for ${version}`));
  }

  return Effect.all(
    systemRecord((system: SupportedSystem): Effect.Effect<string, UpdateError> =>
      checksumForPlatform(platforms, RELEASE_TARGETS[system]),
    ),
  );
}

function manifestChecksums(
  version: string,
  jsonClient: JsonClient,
): Effect.Effect<PlatformChecksums, JsonClientError | UpdateError> {
  const url = `${RELEASE_BASE}/${version}/manifest.json`;

  return Effect.flatMap(
    jsonClient.request(httpRequest(url)),
    <Response extends JsonResponse>(
      response: Response,
    ): Effect.Effect<PlatformChecksums, UpdateError> & Readonly<{ readonly response?: Response }> =>
      platformChecksums(response.value, version),
  );
}

function binaryUrl(version: string, target: string): string {
  return `${RELEASE_BASE}/${version}/${target}/claude`;
}

function checksumsAgree(
  config: PackageHashConfig,
  checksums: PlatformChecksums,
): Effect.Effect<PackageHashConfig, UpdateError> {
  return Effect.as(
    Effect.all(
      systemRecord((system: SupportedSystem): Effect.Effect<void, UpdateError> => {
        const actual = config.platformPackageHashes[system];
        const expected = hexSha256ToSRI(checksums[system]);

        return actual === expected
          ? Effect.void
          : Effect.fail(new UpdateError(`Claude Code checksum mismatch for ${system}`));
      }),
    ),
    config,
  );
}

function packageHashConfig(
  version: string,
  dependencies: UpdateDependencies,
): Effect.Effect<PackageHashConfig, JsonClientError | ReleaseHashError | UpdateError> {
  const urls = releaseUrlsFromTargets(RELEASE_TARGETS, (target: string): string =>
    binaryUrl(version, target),
  );

  return Effect.flatMap(
    Effect.all({
      checksums: manifestChecksums(version, dependencies.jsonClient),
      config: releaseHashConfig(version, urls, "sha256Digest", dependencies.httpClient),
    }),
    ({
      checksums,
      config,
    }: {
      readonly checksums: PlatformChecksums;
      readonly config: PackageHashConfig;
    }): Effect.Effect<PackageHashConfig, UpdateError> => checksumsAgree(config, checksums),
  );
}

function updateProgram(
  args: readonly string[],
  dependencies: UpdateDependencies,
): Effect.Effect<void, HttpClientError | JsonClientError | ReleaseHashError | UpdateError> {
  return updateNewerPinVersion(
    args,
    (): Effect.Effect<string, HttpClientError | UpdateError> =>
      latestVersion(dependencies.httpClient),
    dependencies.pinFilePath,
    (version: string): Effect.Effect<void, JsonClientError | ReleaseHashError | UpdateError> =>
      Effect.flatMap(packageHashConfig(version, dependencies), (config): Effect.Effect<void> =>
        writePackageHashConfig(dependencies.pinFilePath, config),
      ),
  );
}

function cliProgram(
  args: readonly string[],
): Effect.Effect<void, HttpClientError | JsonClientError | ReleaseHashError | UpdateError> {
  return updateProgram(args, {
    httpClient: fetchHttpClient,
    jsonClient: fetchJsonClient,
    pinFilePath: PIN_FILE_PATH,
  });
}

runUpdateScript(import.meta.url, cliProgram);

export { platformChecksums, updateProgram };
export type { UpdateDependencies };
