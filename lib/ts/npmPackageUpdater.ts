import { UpdateError, updateNewerPinVersion } from "./updateScript.ts";
import { npmRegistryPackageUrl, npmVersionIntegrity } from "./npmRegistry.ts";
import { Effect } from "effect";
import type { NpmPackageMetadata } from "./npmRegistryTypes.ts";
import type { PackageHashConfig } from "./packageConfigTypes.ts";
import { latestNpmVersion } from "./latestVersion.ts";
import { npmHashConfigForSystems } from "./npmUpdater.ts";
import { parsePackageHashConfig } from "./packageConfig.ts";
import { systemRecord } from "./system.ts";
import { writePackageHashConfig } from "./pinJson.ts";

type SupportedSystem = Parameters<Parameters<typeof systemRecord>[0]>[0];
type PlatformPackageSuffixes = Readonly<Record<SupportedSystem, string>>;

interface NpmPackageHashUpdateOptions {
  readonly args: readonly string[];
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

function fetchNpmMetadata(packageName: string): Effect.Effect<NpmPackageMetadata, UpdateError> {
  const url = npmRegistryPackageUrl(packageName);

  return Effect.tryPromise({
    catch(error: unknown): UpdateError {
      if (error instanceof UpdateError) {
        return error;
      }

      return new UpdateError(`Failed to parse npm registry JSON from ${url}`);
    },
    async try(): Promise<NpmPackageMetadata> {
      const response = await globalThis.fetch(url);
      if (!response.ok) {
        throw new UpdateError(`Failed to fetch ${url}: HTTP ${response.status}`);
      }

      const metadata: unknown = await response.json();
      return parseRegistryMetadata(metadata, url);
    },
  });
}

function npmPlatformPackageHashConfig(
  packageName: string,
  version: string,
  suffixes: PlatformPackageSuffixes,
): Effect.Effect<PackageHashConfig, Error> {
  return Effect.flatMap(
    fetchNpmMetadata(packageName),
    (metadata: NpmPackageMetadata): Effect.Effect<PackageHashConfig, Error> =>
      npmHashConfigForSystems(metadata, version, suffixes),
  );
}

function npmPackageHash(packageName: string, version: string): Effect.Effect<string, Error> {
  return Effect.flatMap(
    fetchNpmMetadata(packageName),
    (metadata: NpmPackageMetadata): Effect.Effect<string, Error> =>
      npmVersionIntegrity(metadata, version),
  );
}

function npmPackageHashConfig(
  packageName: string,
  version: string,
): Effect.Effect<PackageHashConfig, Error> {
  return Effect.map(
    npmPackageHash(packageName, version),
    (hash: string): PackageHashConfig =>
      parsePackageHashConfig({
        platformPackageHashes: systemRecord((_system: SupportedSystem): string => hash),
        version,
      }),
  );
}

function writePackageHashUpdate(
  options: NpmPackageHashUpdateOptions,
  hashConfigForVersion: (version: string) => Effect.Effect<PackageHashConfig, Error>,
): Effect.Effect<void, Error> {
  return updateNewerPinVersion(
    options.args,
    (): Effect.Effect<string, Error> => latestNpmVersion(options.packageName),
    options.pinFilePath,
    (version: string): Effect.Effect<void, Error> =>
      Effect.flatMap(
        hashConfigForVersion(version),
        (config): Effect.Effect<void> => writePackageHashConfig(options.pinFilePath, config),
      ),
  );
}

function npmPackageHashUpdateProgram(
  options: NpmPackageHashUpdateOptions,
): Effect.Effect<void, Error> {
  return writePackageHashUpdate(
    options,
    (version: string): Effect.Effect<PackageHashConfig, Error> =>
      npmPackageHashConfig(options.packageName, version),
  );
}

function npmPlatformPackageHashUpdateProgram(
  options: NpmPlatformPackageHashUpdateOptions,
): Effect.Effect<void, Error> {
  return writePackageHashUpdate(
    options,
    (version: string): Effect.Effect<PackageHashConfig, Error> =>
      npmPlatformPackageHashConfig(options.packageName, version, options.suffixes),
  );
}

export {
  npmPackageHash,
  npmPackageHashConfig,
  npmPackageHashUpdateProgram,
  npmPlatformPackageHashConfig,
  npmPlatformPackageHashUpdateProgram,
};
