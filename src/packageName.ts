import { Effect } from "effect";

const PACKAGE_NAME_PATTERN = /^[a-z][A-Za-z0-9]*$/u;

type PackageName = string;

class InvalidPackageNameError extends Error {
  public readonly value: string;

  public constructor(value: string) {
    super(`Invalid package name: ${value}`);
    this.name = "InvalidPackageNameError";
    this.value = value;
  }
}

function packageName(value: string): Effect.Effect<PackageName, InvalidPackageNameError> {
  if (!PACKAGE_NAME_PATTERN.test(value)) {
    return Effect.fail(new InvalidPackageNameError(value));
  }

  return Effect.succeed(value);
}

function parsePackageName(value: string): PackageName {
  return Effect.runSync(packageName(value));
}

export { InvalidPackageNameError, packageName, parsePackageName };
export type { PackageName };
