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
import { Effect } from "effect";
import { formatSriHash } from "coolheaded/pin/sriHash.ts";
import { parsePackageHashConfig } from "coolheaded/pin/packageHashConfig.ts";
import { systemRecord } from "coolheaded/system/target.ts";
import { writePackageHashConfig } from "coolheaded/pin/json.ts";

const HEX_BYTE_WIDTH = 2;
const HEX_RADIX = 16;
const MANIFEST_URL = "https://static.qoder.com.cn/qoder-cli-cn/channels/manifest.json";
const PIN_FILE_PATH = scriptPath("pin.json", import.meta.url);
const RELEASE_BASE = "https://static.qoder.com.cn/qoder-cli-cn/releases";
const REQUEST_TIMEOUT_MS = 30_000;
const ASSET_TIMEOUT_MS = 120_000;

type PackageHashConfig = ReturnType<typeof parsePackageHashConfig>;
type SriHash = ReturnType<typeof formatSriHash>;
type SupportedSystem = Parameters<Parameters<typeof systemRecord>[0]>[0];
type ReleasePlatform = Readonly<{
  readonly arch: string;
  readonly asset: string;
  readonly os: string;
}>;

const RELEASE_PLATFORMS = {
  "aarch64-darwin": {
    arch: "arm64",
    asset: "qoderclicn-darwin-arm64.tar.gz",
    os: "darwin",
  },
  "aarch64-linux": {
    arch: "arm64",
    asset: "qoderclicn-linux-arm64.tar.gz",
    os: "linux",
  },
  "x86_64-linux": {
    arch: "amd64",
    asset: "qoderclicn-linux-x64.tar.gz",
    os: "linux",
  },
} as const satisfies Readonly<Record<SupportedSystem, ReleasePlatform>>;

interface ManifestFile {
  readonly arch: string;
  readonly os: string;
  readonly sha256: string;
  readonly url: string;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function releaseUrl(version: string, system: SupportedSystem): string {
  return `${RELEASE_BASE}/${version}/${RELEASE_PLATFORMS[system].asset}`;
}

function hexToBytes(hex: string): readonly number[] {
  const bytes: number[] = [];

  for (let offset = 0; offset < hex.length; offset += HEX_BYTE_WIDTH) {
    bytes.push(Number.parseInt(hex.slice(offset, offset + HEX_BYTE_WIDTH), HEX_RADIX));
  }

  return bytes;
}

function sha256Hex(bytes: readonly number[]): Effect.Effect<string> {
  return Effect.promise(async (): Promise<string> => {
    const digest = new Uint8Array(
      await globalThis.crypto.subtle.digest("SHA-256", Uint8Array.from(bytes)),
    );
    return Array.from(digest, (byte: number): string =>
      byte.toString(HEX_RADIX).padStart(HEX_BYTE_WIDTH, "0"),
    ).join("");
  });
}

function manifestFile(value: unknown): ManifestFile | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const { arch, os, sha256, url } = value;
  if (
    typeof arch !== "string" ||
    typeof os !== "string" ||
    typeof sha256 !== "string" ||
    typeof url !== "string"
  ) {
    return undefined;
  }

  return { arch, os, sha256, url };
}

function parseManifestFiles(value: unknown): Effect.Effect<readonly ManifestFile[], UpdateError> {
  if (!Array.isArray(value)) {
    return Effect.fail(new UpdateError(`Invalid manifest from ${MANIFEST_URL}`));
  }

  const files: ManifestFile[] = [];
  for (const entry of value) {
    const file = manifestFile(entry);
    if (file === undefined) {
      return Effect.fail(new UpdateError(`Invalid manifest from ${MANIFEST_URL}`));
    }
    files.push(file);
  }

  return Effect.succeed(files);
}

function parseManifest(
  value: unknown,
): Effect.Effect<
  Readonly<{ readonly files: readonly ManifestFile[]; readonly latest: string }>,
  UpdateError
> {
  if (!isRecord(value)) {
    return Effect.fail(new UpdateError(`Invalid manifest from ${MANIFEST_URL}`));
  }

  const { files: manifestFiles, latest } = value;
  if (typeof latest !== "string" || latest.length === 0) {
    return Effect.fail(new UpdateError(`Invalid manifest from ${MANIFEST_URL}`));
  }

  return Effect.map(parseManifestFiles(manifestFiles), (files) => ({
    files,
    latest,
  }));
}

function responseValue<Response extends JsonResponse>(response: Response): Response["value"] {
  return response.value;
}

function fetchManifest(
  jsonClient: Readonly<JsonClient>,
): Effect.Effect<
  Readonly<{ readonly files: readonly ManifestFile[]; readonly latest: string }>,
  JsonClientError | UpdateError
> {
  return Effect.flatMap(
    Effect.map(
      jsonClient.request({
        headers: {},
        method: "GET",
        timeoutMs: REQUEST_TIMEOUT_MS,
        url: MANIFEST_URL,
      }),
      responseValue,
    ),
    parseManifest,
  );
}

function platformFile(
  files: readonly ManifestFile[],
  system: SupportedSystem,
): Effect.Effect<ManifestFile, UpdateError> {
  const platform = RELEASE_PLATFORMS[system];
  const matches = files.filter(
    (file: ManifestFile): boolean => file.os === platform.os && file.arch === platform.arch,
  );
  const [file] = matches;
  if (matches.length !== 1 || file === undefined) {
    return Effect.fail(new UpdateError(`Missing Qoder CLI CN asset for ${system}`));
  }

  return Effect.succeed(file);
}

function verifiedHash(
  httpClient: Readonly<HttpClient>,
  file: ManifestFile,
  version: string,
  system: SupportedSystem,
): Effect.Effect<SriHash, HttpClientError | UpdateError> {
  const url = releaseUrl(version, system);
  if (file.url !== url || !/^[0-9a-f]{64}$/u.test(file.sha256)) {
    return Effect.fail(new UpdateError(`Unexpected Qoder CLI CN asset for ${system}`));
  }

  return Effect.flatMap(
    httpClient.request({
      headers: {},
      method: "GET",
      timeoutMs: ASSET_TIMEOUT_MS,
      url,
    }),
    <Response extends HttpResponse>(
      response: Response,
    ): Effect.Effect<SriHash, UpdateError> & Readonly<{ readonly response?: Response }> =>
      Effect.flatMap(
        sha256Hex([...response.body]),
        (hex: string): Effect.Effect<SriHash, UpdateError> =>
          hex === file.sha256
            ? Effect.succeed(formatSriHash("sha256", hexToBytes(hex)))
            : Effect.fail(new UpdateError(`Checksum mismatch for ${system}`)),
      ),
  );
}

function releaseHashConfig(
  manifest: Readonly<{ readonly files: readonly ManifestFile[]; readonly latest: string }>,
  httpClient: Readonly<HttpClient>,
): Effect.Effect<PackageHashConfig, HttpClientError | UpdateError> {
  return Effect.flatMap(
    Effect.all(
      systemRecord(
        (system: SupportedSystem): Effect.Effect<SriHash, HttpClientError | UpdateError> =>
          Effect.flatMap(platformFile(manifest.files, system), (file: ManifestFile) =>
            verifiedHash(httpClient, file, manifest.latest, system),
          ),
      ),
    ),
    (hashes): Effect.Effect<PackageHashConfig, UpdateError> =>
      Effect.succeed(
        parsePackageHashConfig({
          platformPackageHashes: hashes,
          version: manifest.latest,
        }),
      ),
  );
}

function officialRelease(
  httpClient: Readonly<HttpClient>,
  jsonClient: Readonly<JsonClient>,
): Effect.Effect<PackageHashConfig, HttpClientError | JsonClientError | UpdateError> {
  return Effect.flatMap(fetchManifest(jsonClient), (manifest) =>
    releaseHashConfig(manifest, httpClient),
  );
}

function latestVersion(
  jsonClient: Readonly<JsonClient>,
): Effect.Effect<string, JsonClientError | UpdateError> {
  return Effect.map(fetchManifest(jsonClient), (manifest): string => manifest.latest);
}

function updateProgram(
  args: readonly string[],
  httpClient: Readonly<HttpClient>,
  jsonClient: Readonly<JsonClient>,
  pinFilePath: string,
): ReturnType<
  typeof updateNewerPinVersion<
    JsonClientError | UpdateError,
    HttpClientError | JsonClientError | UpdateError
  >
> {
  return updateNewerPinVersion(
    args,
    (): ReturnType<typeof latestVersion> => latestVersion(jsonClient),
    pinFilePath,
    (version: string): Effect.Effect<void, HttpClientError | JsonClientError | UpdateError> =>
      Effect.flatMap(
        officialRelease(httpClient, jsonClient),
        (config: PackageHashConfig): Effect.Effect<void, UpdateError> =>
          config.version === version
            ? writePackageHashConfig(pinFilePath, config)
            : Effect.fail(
                new UpdateError(`Requested Qoder CLI CN ${version}, latest is ${config.version}`),
              ),
      ),
  );
}

runUpdateScript(import.meta.url, (args: readonly string[]) =>
  updateProgram(args, fetchHttpClient, fetchJsonClient, PIN_FILE_PATH),
);
