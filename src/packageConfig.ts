import { Effect } from "effect";
import type { PackageHashConfig } from "./packageConfigTypes.ts";
import type { SupportedSystem } from "./system.ts";

class InvalidPackageHashConfigError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "InvalidPackageHashConfigError";
  }
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function objectRecord(
  value: unknown,
  name: string,
): Effect.Effect<
  Readonly<Record<string, unknown>>,
  InvalidPackageHashConfigError
> {
  if (!isRecord(value)) {
    return Effect.fail(
      new InvalidPackageHashConfigError(`${name} must be an object`),
    );
  }

  return Effect.succeed(value);
}

function hashForSystem(
  hashes: Readonly<Record<string, unknown>>,
  system: SupportedSystem,
): Effect.Effect<string, InvalidPackageHashConfigError> {
  const hash = hashes[system];
  if (typeof hash !== "string" || hash.length === 0) {
    return Effect.fail(
      new InvalidPackageHashConfigError(`Missing hash for ${system}`),
    );
  }

  return Effect.succeed(hash);
}

function packageHashes(
  value: unknown,
): Effect.Effect<
  Readonly<Record<SupportedSystem, string>>,
  InvalidPackageHashConfigError
> {
  return Effect.flatMap(
    objectRecord(value, "hashes"),
    (
      hashes: Readonly<Record<string, unknown>>,
    ): Effect.Effect<
      Readonly<Record<SupportedSystem, string>>,
      InvalidPackageHashConfigError
    > =>
      Effect.all({
        "aarch64-darwin": hashForSystem(hashes, "aarch64-darwin"),
        "aarch64-linux": hashForSystem(hashes, "aarch64-linux"),
        "x86_64-linux": hashForSystem(hashes, "x86_64-linux"),
      }),
  );
}

function packageHashConfig(
  value: unknown,
): Effect.Effect<PackageHashConfig, InvalidPackageHashConfigError> {
  return Effect.flatMap(
    objectRecord(value, "package hash config"),
    (
      object: Readonly<Record<string, unknown>>,
    ): Effect.Effect<PackageHashConfig, InvalidPackageHashConfigError> => {
      const { version } = object;
      if (typeof version !== "string" || version.length === 0) {
        return Effect.fail(
          new InvalidPackageHashConfigError("Missing package version"),
        );
      }

      return Effect.map(
        packageHashes(object["hashes"]),
        (
          hashes: Readonly<Record<SupportedSystem, string>>,
        ): PackageHashConfig => (
          {
            hashes,
            version,
          }
        ),
      );
    },
  );
}

function parsePackageHashConfig(value: unknown): PackageHashConfig {
  return Effect.runSync(packageHashConfig(value));
}

export {
  InvalidPackageHashConfigError,
  packageHashConfig,
  parsePackageHashConfig,
};
export type { PackageHashConfig };
