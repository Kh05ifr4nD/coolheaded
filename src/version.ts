const SEMVER_PATTERN = /^(?<version>\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)$/u;

function semverParts(version: string): readonly number[] {
  return version
    .split(/[.+-]/u)
    .slice(0, 3)
    .map((part: string): number => Number.parseInt(part, 10));
}

function compareVersions(left: string, right: string): number {
  const leftParts = semverParts(left);
  const rightParts = semverParts(right);

  for (const index of [0, 1, 2]) {
    const diff = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (diff !== 0) {
      return diff;
    }
  }

  return left.localeCompare(right);
}

function isSemver(version: string): boolean {
  return SEMVER_PATTERN.test(version);
}

export { compareVersions, isSemver };
