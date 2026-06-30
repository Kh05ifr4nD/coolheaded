import { Effect } from "effect";
import type { PackageHashConfig } from "./packageConfigTypes.ts";
import { SUPPORTED_SYSTEMS } from "./system.ts";

type SupportedSystem = (typeof SUPPORTED_SYSTEMS)[number];

class InvalidPackageHashConfigError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "InvalidPackageHashConfigError";
  }
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function packageHashConfigError(error: unknown): InvalidPackageHashConfigError {
  return error instanceof InvalidPackageHashConfigError
    ? error
    : new InvalidPackageHashConfigError(String(error));
}

function objectRecord(value: unknown, name: string): Readonly<Record<string, unknown>> {
  if (!isRecord(value)) {
    throw new InvalidPackageHashConfigError(`${name} must be an object`);
  }

  return value;
}

function hashForSystem(hashes: Readonly<Record<string, unknown>>, system: SupportedSystem): string {
  const hash = hashes[system];
  if (typeof hash !== "string" || hash.length === 0) {
    throw new InvalidPackageHashConfigError(`Missing hash for ${system}`);
  }

  return hash;
}

function optionalNonEmptyString(
  object: Readonly<Record<string, unknown>>,
  fieldName: string,
): string | undefined {
  const value = object[fieldName];
  if (value === undefined) {
    return void 0;
  }

  if (typeof value !== "string" || value.length === 0) {
    throw new InvalidPackageHashConfigError(`${fieldName} must be a non-empty string`);
  }

  return value;
}

function platformPackageHashes(value: unknown): Readonly<Record<SupportedSystem, string>> {
  const hashes = objectRecord(value, "platformPackageHashes");
  const [aarch64Darwin, aarch64Linux, x8664Linux] = SUPPORTED_SYSTEMS;

  return {
    [aarch64Darwin]: hashForSystem(hashes, aarch64Darwin),
    [aarch64Linux]: hashForSystem(hashes, aarch64Linux),
    [x8664Linux]: hashForSystem(hashes, x8664Linux),
  } satisfies Readonly<Record<SupportedSystem, string>>;
}

function parsePackageHashConfig(value: unknown): PackageHashConfig {
  const object = objectRecord(value, "package hash config");
  const { version } = object;
  if (typeof version !== "string" || version.length === 0) {
    throw new InvalidPackageHashConfigError("Missing package version");
  }

  const binaryVersion = optionalNonEmptyString(object, "binaryVersion");

  return {
    ...(binaryVersion === undefined ? {} : { binaryVersion }),
    platformPackageHashes: platformPackageHashes(object["platformPackageHashes"]),
    version,
  };
}

function packageHashConfig(
  value: unknown,
): Effect.Effect<PackageHashConfig, InvalidPackageHashConfigError> {
  return Effect.try({
    catch: packageHashConfigError,
    try: (): PackageHashConfig => parsePackageHashConfig(value),
  });
}

export { InvalidPackageHashConfigError, packageHashConfig, parsePackageHashConfig };
export type { PackageHashConfig } from "./packageConfigTypes.ts";
