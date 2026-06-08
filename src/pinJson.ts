import type { Effect } from "effect";
import type { PackageHashConfig } from "./packageConfigTypes.ts";
import { writeTextFile } from "./updateScript.ts";

const JSON_INDENT = 2;
const JSON_FIELD_ORDER = [
  "version",
  "hashes",
  "aarch64-darwin",
  "aarch64-linux",
  "x86_64-linux",
] as const satisfies readonly string[];

function serializePackageHashConfig(config: PackageHashConfig): string {
  return `${JSON.stringify(config, [...JSON_FIELD_ORDER], JSON_INDENT)}\n`;
}

function writePackageHashConfig(path: string, config: PackageHashConfig): Effect.Effect<void> {
  return writeTextFile(path, serializePackageHashConfig(config));
}

export { serializePackageHashConfig, writePackageHashConfig };
