import { InvalidSriHashError, parseSriHash } from "coolheaded/pin/sriHash.ts";
import { Effect } from "effect";
import { SUPPORTED_SYSTEMS } from "coolheaded/system/target.ts";

type SriHash = ReturnType<typeof parseSriHash>;
type SupportedSystem = (typeof SUPPORTED_SYSTEMS)[number];
interface PackageHashConfig {
  readonly binaryVersion?: string;
  readonly platformPackageHashes: Readonly<Partial<Record<SupportedSystem, SriHash>>>;
  readonly version: string;
}

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

function hashForSystem(
  hashes: Readonly<Record<string, unknown>>,
  system: SupportedSystem,
): SriHash {
  const hash = hashes[system];
  if (hash === undefined) {
    throw new InvalidPackageHashConfigError(`Missing hash for ${system}`);
  }

  try {
    return parseSriHash(hash);
  } catch (error: unknown) {
    if (error instanceof InvalidSriHashError) {
      throw new InvalidPackageHashConfigError(`Invalid hash for ${system}: ${error.message}`);
    }
    throw error;
  }
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

function platformPackageHashes(
  value: unknown,
): Readonly<Partial<Record<SupportedSystem, SriHash>>> {
  const hashes = objectRecord(value, "platformPackageHashes");
  const entries = Object.entries(hashes);
  if (entries.length === 0) {
    throw new InvalidPackageHashConfigError("platformPackageHashes must not be empty");
  }

  const validEntries = entries.map(
    (entry: readonly [string, unknown]): readonly [SupportedSystem, SriHash] => {
      const [name] = entry;
      const system = SUPPORTED_SYSTEMS.find((candidate) => candidate === name);
      if (system === undefined) {
        throw new InvalidPackageHashConfigError(`Unsupported system for pin hash: ${name}`);
      }
      return [system, hashForSystem(hashes, system)];
    },
  );
  return Object.fromEntries(validEntries);
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
export type { PackageHashConfig };
