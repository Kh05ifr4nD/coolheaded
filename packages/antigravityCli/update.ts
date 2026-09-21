import type { JsonClient, JsonClientError, JsonResponse } from "coolheaded/core/httpClient.ts";
import {
  UpdateError,
  runUpdateScript,
  scriptPath,
  updateNewerPinVersion,
} from "coolheaded/core/updateScript.ts";
import { Effect } from "effect";
import { fetchJsonClient } from "coolheaded/core/fetchHttpClient.ts";
import { formatSriHash } from "coolheaded/pin/sriHash.ts";
import { parsePackageHashConfig } from "coolheaded/pin/packageHashConfig.ts";
import { systemRecord } from "coolheaded/system/target.ts";
import { writePackageHashConfig } from "coolheaded/pin/json.ts";

const HEX_BYTE_WIDTH = 2;
const HEX_RADIX = 16;
const MANIFEST_BASE =
  "https://antigravity-cli-auto-updater-974169037036.us-central1.run.app/manifests";
const PIN_FILE_PATH = scriptPath("pin.json", import.meta.url);
const REQUEST_TIMEOUT_MS = 30_000;
const SHA512_HEX_LENGTH = 128;

type PackageHashConfig = ReturnType<typeof parsePackageHashConfig>;
type SriHash = ReturnType<typeof formatSriHash>;
type SupportedSystem = Parameters<Parameters<typeof systemRecord>[0]>[0];

const MANIFEST_PLATFORMS = {
  "aarch64-darwin": "darwin_arm64",
  "aarch64-linux": "linux_arm64",
  "x86_64-linux": "linux_amd64",
} as const satisfies Readonly<Record<SupportedSystem, string>>;

interface Manifest {
  readonly sha512: SriHash;
  readonly url: string;
  readonly version: string;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hexToBytes(hex: string): readonly number[] {
  const bytes: number[] = [];

  for (let offset = 0; offset < hex.length; offset += HEX_BYTE_WIDTH) {
    bytes.push(Number.parseInt(hex.slice(offset, offset + HEX_BYTE_WIDTH), HEX_RADIX));
  }

  return bytes;
}

function hexSha512ToSRI(hex: string, source: string): Effect.Effect<SriHash, UpdateError> {
  if (hex.length !== SHA512_HEX_LENGTH || !/^[0-9a-f]+$/u.test(hex)) {
    return Effect.fail(new UpdateError(`Invalid sha512 from ${source}`));
  }

  return Effect.succeed(formatSriHash("sha512", hexToBytes(hex)));
}

function artifactVersionFromUrl(url: string): string | undefined {
  return /\/antigravity-cli\/(?<artifactVersion>[^/]+)\//u.exec(url)?.groups?.["artifactVersion"];
}

function parseManifest(value: unknown, source: string): Effect.Effect<Manifest, UpdateError> {
  if (!isRecord(value)) {
    return Effect.fail(new UpdateError(`Invalid manifest from ${source}`));
  }

  const { sha512, url, version } = value;
  if (typeof sha512 !== "string" || typeof url !== "string" || typeof version !== "string") {
    return Effect.fail(new UpdateError(`Invalid manifest from ${source}`));
  }

  const artifactVersion = artifactVersionFromUrl(url);
  if (artifactVersion === undefined || !artifactVersion.startsWith(`${version}-`)) {
    return Effect.fail(new UpdateError(`Missing artifact version from ${source}`));
  }

  return Effect.map(hexSha512ToSRI(sha512, source), (hash: SriHash): Manifest => ({
    sha512: hash,
    url,
    version: artifactVersion,
  }));
}

function responseValue<Response extends JsonResponse>(response: Response): Response["value"] {
  return response.value;
}

function fetchManifest(
  system: SupportedSystem,
  jsonClient: Readonly<JsonClient>,
): Effect.Effect<Manifest, JsonClientError | UpdateError> {
  const url = `${MANIFEST_BASE}/${MANIFEST_PLATFORMS[system]}.json`;

  return Effect.flatMap(
    Effect.map(
      jsonClient.request({
        headers: {},
        method: "GET",
        timeoutMs: REQUEST_TIMEOUT_MS,
        url,
      }),
      responseValue,
    ),
    (value: unknown): Effect.Effect<Manifest, UpdateError> => parseManifest(value, url),
  );
}

function releaseHashConfig(
  manifests: Readonly<Record<SupportedSystem, Manifest>>,
): Effect.Effect<PackageHashConfig, UpdateError> {
  const versions = new Set(
    Object.values(manifests).map((manifest: Manifest): string => manifest.version),
  );
  const [version] = versions;
  if (typeof version !== "string" || versions.size !== 1) {
    return Effect.fail(new UpdateError("Antigravity CLI platforms published different versions"));
  }

  const marketingSeparator = version.lastIndexOf("-");
  const hashes = systemRecord((system: SupportedSystem): SriHash => manifests[system].sha512);

  return Effect.succeed(
    parsePackageHashConfig({
      binaryVersion: version.slice(0, marketingSeparator),
      platformPackageHashes: hashes,
      version,
    }),
  );
}

function officialRelease(
  jsonClient: Readonly<JsonClient>,
): Effect.Effect<PackageHashConfig, JsonClientError | UpdateError> {
  return Effect.flatMap(
    Effect.all(
      systemRecord(
        (system: SupportedSystem): Effect.Effect<Manifest, JsonClientError | UpdateError> =>
          fetchManifest(system, jsonClient),
      ),
    ),
    releaseHashConfig,
  );
}

function latestVersion(
  jsonClient: Readonly<JsonClient>,
): Effect.Effect<string, JsonClientError | UpdateError> {
  return Effect.map(
    officialRelease(jsonClient),
    (config: PackageHashConfig): string => config.version,
  );
}

function updateProgram(
  args: readonly string[],
  jsonClient: Readonly<JsonClient>,
  pinFilePath: string,
): ReturnType<
  typeof updateNewerPinVersion<JsonClientError | UpdateError, JsonClientError | UpdateError>
> {
  return updateNewerPinVersion(
    args,
    (): ReturnType<typeof latestVersion> => latestVersion(jsonClient),
    pinFilePath,
    (version: string): Effect.Effect<void, JsonClientError | UpdateError> =>
      Effect.flatMap(
        officialRelease(jsonClient),
        (config: PackageHashConfig): Effect.Effect<void, UpdateError> =>
          config.version === version
            ? writePackageHashConfig(pinFilePath, config)
            : Effect.fail(
                new UpdateError(
                  `Requested Antigravity CLI ${version}, latest is ${config.version}`,
                ),
              ),
      ),
  );
}

runUpdateScript(import.meta.url, (args: readonly string[]) =>
  updateProgram(args, fetchJsonClient, PIN_FILE_PATH),
);
