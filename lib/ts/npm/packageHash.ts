import type { JsonClient, JsonClientError, JsonResponse } from "coolheaded/core/httpClient.ts";
import { UpdateError, updateNewerPinVersion } from "coolheaded/core/updateScript.ts";
import { npmRegistryPackageUrl, npmVersionIntegrity } from "coolheaded/npm/registry.ts";
import { Effect } from "effect";
import type { InvalidNpmMetadataError } from "coolheaded/npm/metadataError.ts";
import type { NpmPackageMetadata } from "coolheaded/npm/metadata.ts";
import { latestNpmVersion } from "coolheaded/source/version.ts";
import { npmHashConfigForSystems } from "coolheaded/npm/platformHash.ts";
import { packageHashConfig } from "coolheaded/pin/packageHashConfig.ts";
import { systemRecord } from "coolheaded/system/target.ts";
import { writePackageHashConfig } from "coolheaded/pin/json.ts";

type PackageHashConfig = Effect.Effect.Success<ReturnType<typeof packageHashConfig>>;
type InvalidPackageHashConfigError = Effect.Effect.Error<ReturnType<typeof packageHashConfig>>;
type LatestNpmVersionError = Effect.Effect.Error<ReturnType<typeof latestNpmVersion>>;
type SupportedSystem = Parameters<Parameters<typeof systemRecord>[0]>[0];
type PlatformPackageSuffixes = Readonly<Record<SupportedSystem, string>>;
const REQUEST_TIMEOUT_MS = 30_000;

interface NpmPackageHashUpdateOptions {
  readonly args: readonly string[];
  readonly jsonClient: JsonClient;
  readonly packageName: string;
  readonly pinFilePath: string;
}

interface NpmPlatformPackageHashUpdateOptions extends NpmPackageHashUpdateOptions {
  readonly suffixes: PlatformPackageSuffixes;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseRegistryMetadata(value: unknown, url: string): NpmPackageMetadata {
  if (!isRecord(value) || !isRecord(value["versions"])) {
    throw new UpdateError(`Invalid npm registry JSON from ${url}`);
  }

  return value;
}

function responseValue<Response extends JsonResponse>(response: Response): Response["value"] {
  return response.value;
}

function fetchNpmMetadata(
  packageName: string,
  jsonClient: Readonly<JsonClient>,
): Effect.Effect<NpmPackageMetadata, JsonClientError | UpdateError> {
  const url = npmRegistryPackageUrl(packageName);
  return Effect.flatMap(
    Effect.map(
      jsonClient.request({ headers: {}, method: "GET", timeoutMs: REQUEST_TIMEOUT_MS, url }),
      responseValue,
    ),
    (value: unknown): Effect.Effect<NpmPackageMetadata, UpdateError> =>
      Effect.try({
        catch: (): UpdateError => new UpdateError(`Invalid npm registry JSON from ${url}`),
        try: (): NpmPackageMetadata => parseRegistryMetadata(value, url),
      }),
  );
}

function npmPlatformPackageHashConfig(
  packageName: string,
  version: string,
  suffixes: PlatformPackageSuffixes,
  jsonClient: Readonly<JsonClient>,
): Effect.Effect<
  PackageHashConfig,
  InvalidNpmMetadataError | InvalidPackageHashConfigError | JsonClientError | UpdateError
> {
  return Effect.flatMap(
    fetchNpmMetadata(packageName, jsonClient),
    (
      metadata: NpmPackageMetadata,
    ): Effect.Effect<PackageHashConfig, InvalidNpmMetadataError | InvalidPackageHashConfigError> =>
      npmHashConfigForSystems(metadata, version, suffixes),
  );
}

function npmPackageHash(
  packageName: string,
  version: string,
  jsonClient: Readonly<JsonClient>,
): Effect.Effect<string, InvalidNpmMetadataError | JsonClientError | UpdateError> {
  return Effect.flatMap(
    fetchNpmMetadata(packageName, jsonClient),
    (metadata: NpmPackageMetadata): Effect.Effect<string, InvalidNpmMetadataError> =>
      npmVersionIntegrity(metadata, version),
  );
}

function npmPackageHashConfig(
  packageName: string,
  version: string,
  jsonClient: Readonly<JsonClient>,
): Effect.Effect<
  PackageHashConfig,
  InvalidNpmMetadataError | InvalidPackageHashConfigError | JsonClientError | UpdateError
> {
  return Effect.flatMap(
    npmPackageHash(packageName, version, jsonClient),
    (hash: string): Effect.Effect<PackageHashConfig, InvalidPackageHashConfigError> =>
      packageHashConfig({
        platformPackageHashes: systemRecord((_system: SupportedSystem): string => hash),
        version,
      }),
  );
}

function writePackageHashUpdate(
  options: NpmPackageHashUpdateOptions,
  hashConfigForVersion: (
    version: string,
  ) => Effect.Effect<
    PackageHashConfig,
    InvalidNpmMetadataError | InvalidPackageHashConfigError | JsonClientError | UpdateError
  >,
): Effect.Effect<
  void,
  | InvalidNpmMetadataError
  | InvalidPackageHashConfigError
  | JsonClientError
  | LatestNpmVersionError
  | UpdateError
> {
  return updateNewerPinVersion(
    options.args,
    (): ReturnType<typeof latestNpmVersion> =>
      latestNpmVersion(options.packageName, options.jsonClient),
    options.pinFilePath,
    (
      version: string,
    ): Effect.Effect<
      void,
      InvalidNpmMetadataError | InvalidPackageHashConfigError | JsonClientError | UpdateError
    > =>
      Effect.flatMap(
        hashConfigForVersion(version),
        (config): Effect.Effect<void> => writePackageHashConfig(options.pinFilePath, config),
      ),
  );
}

function npmPackageHashUpdateProgram(
  options: NpmPackageHashUpdateOptions,
): ReturnType<typeof writePackageHashUpdate> {
  return writePackageHashUpdate(
    options,
    (version: string): ReturnType<typeof npmPackageHashConfig> =>
      npmPackageHashConfig(options.packageName, version, options.jsonClient),
  );
}

function npmPlatformPackageHashUpdateProgram(
  options: NpmPlatformPackageHashUpdateOptions,
): ReturnType<typeof writePackageHashUpdate> {
  return writePackageHashUpdate(
    options,
    (version: string): ReturnType<typeof npmPlatformPackageHashConfig> =>
      npmPlatformPackageHashConfig(
        options.packageName,
        version,
        options.suffixes,
        options.jsonClient,
      ),
  );
}

export {
  npmPackageHash,
  npmPackageHashConfig,
  npmPackageHashUpdateProgram,
  npmPlatformPackageHashConfig,
  npmPlatformPackageHashUpdateProgram,
};
