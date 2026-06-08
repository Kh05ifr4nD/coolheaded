import { npmPlatformPackageVersion, npmVersionIntegrity } from "./npmRegistry.ts";
import { Effect } from "effect";
import type { InvalidNpmMetadataError } from "./npmRegistryErrors.ts";
import type { NpmPackageMetadata } from "./npmRegistryTypes.ts";
import type { PackageHashConfig } from "./packageConfigTypes.ts";
import type { SupportedSystem } from "./system.ts";
import { parsePackageHashConfig } from "./packageConfig.ts";

type NpmPlatformSuffixes<System extends string = string> = Readonly<Record<System, string>>;

function entryHashEffect(
  metadata: NpmPackageMetadata,
  version: string,
  entry: readonly [string, string],
): Effect.Effect<readonly [string, string], InvalidNpmMetadataError> {
  const [system, suffix] = entry;
  const platformVersion = npmPlatformPackageVersion(version, suffix);

  return Effect.map(
    npmVersionIntegrity(metadata, platformVersion),
    (integrity: string): readonly [string, string] => [system, integrity],
  );
}

function entriesToHashes(entries: readonly (readonly [string, string])[]): Record<string, string> {
  return Object.fromEntries(entries);
}

function suffixEntries(suffixes: NpmPlatformSuffixes): readonly (readonly [string, string])[] {
  const entries: (readonly [string, string])[] = [];

  for (const system in suffixes) {
    if (Object.hasOwn(suffixes, system)) {
      const suffix = suffixes[system];
      if (typeof suffix === "string") {
        entries.push([system, suffix]);
      }
    }
  }

  return entries;
}

function npmHashesForSystems(
  metadata: NpmPackageMetadata,
  version: string,
  suffixes: NpmPlatformSuffixes,
): Effect.Effect<Record<string, string>, InvalidNpmMetadataError> {
  return Effect.all(
    suffixEntries(suffixes).map(
      (
        entry: readonly [string, string],
      ): Effect.Effect<readonly [string, string], InvalidNpmMetadataError> =>
        entryHashEffect(metadata, version, entry),
    ),
  ).pipe(Effect.map(entriesToHashes));
}

function npmHashConfigForSystems(
  metadata: NpmPackageMetadata,
  version: string,
  suffixes: NpmPlatformSuffixes<SupportedSystem>,
): Effect.Effect<PackageHashConfig, InvalidNpmMetadataError> {
  return Effect.map(
    npmHashesForSystems(metadata, version, suffixes),
    (hashes: Readonly<Record<string, string>>): PackageHashConfig =>
      parsePackageHashConfig({
        hashes,
        version,
      }),
  );
}

export { npmHashConfigForSystems, npmHashesForSystems };
export type { NpmPlatformSuffixes };
