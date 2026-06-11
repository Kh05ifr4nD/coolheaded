import { Effect } from "effect";
import { InvalidNpmMetadataError } from "./npmRegistryErrors.ts";
import type { NpmPackageMetadata } from "./npmRegistryTypes.ts";

function npmRegistryPackageUrl(packageName: string): string {
  return `https://registry.npmjs.org/${encodeURIComponent(packageName)}`;
}

function npmScopedTarballUrl(
  packageName: string,
  tarballBaseName: string,
  version: string,
): string {
  return `https://registry.npmjs.org/${packageName}/-/${tarballBaseName}-${version}.tgz`;
}

function npmPlatformPackageVersion(version: string, suffix: string): string {
  return `${version}-${suffix}`;
}

function npmVersionIntegrity(
  metadata: NpmPackageMetadata,
  version: string,
): Effect.Effect<string, InvalidNpmMetadataError> {
  const integrity = metadata.versions?.[version]?.dist?.integrity;
  if (typeof integrity !== "string" || integrity.length === 0) {
    return Effect.fail(new InvalidNpmMetadataError(`Missing npm integrity for ${version}`));
  }

  return Effect.succeed(integrity);
}

export {
  InvalidNpmMetadataError,
  npmPlatformPackageVersion,
  npmRegistryPackageUrl,
  npmScopedTarballUrl,
  npmVersionIntegrity,
};
export type { NpmPackageMetadata };
