import { compare as compareSemvers, valid } from "semver";

function canonicalSemver(version: string): string | null {
  const buildMetadataIndex = version.indexOf("+");
  const precedenceVersion =
    buildMetadataIndex === -1 ? version : version.slice(0, buildMetadataIndex);

  return valid(version) === precedenceVersion ? version : null;
}

function parseSemver(version: string): string {
  const parsed = canonicalSemver(version);
  if (parsed === null) {
    throw new TypeError(`Invalid SemVer: ${version}`);
  }

  return parsed;
}

function compareVersions(left: string, right: string): number {
  return compareSemvers(parseSemver(left), parseSemver(right));
}

function isSemver(version: string): boolean {
  return canonicalSemver(version) !== null;
}

export { compareVersions, isSemver };
