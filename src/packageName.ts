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

function parsePackageName(value: string): PackageName {
  if (!PACKAGE_NAME_PATTERN.test(value)) {
    throw new InvalidPackageNameError(value);
  }

  return value;
}

function packageName(value: string): Effect.Effect<PackageName, InvalidPackageNameError> {
  try {
    return Effect.succeed(parsePackageName(value));
  } catch (error: unknown) {
    const packageNameError =
      error instanceof InvalidPackageNameError ? error : new InvalidPackageNameError(value);

    return Effect.fail(packageNameError);
  }
}

export { InvalidPackageNameError, packageName, parsePackageName };
export type { PackageName };
