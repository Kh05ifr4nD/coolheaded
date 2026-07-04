import type { Effect } from "effect";
import type { PackageHashConfig } from "coolheaded/pin/packageHashConfig.ts";
import { SUPPORTED_SYSTEMS } from "coolheaded/system/target.ts";
import { writeTextFile } from "coolheaded/core/updateScript.ts";

type SupportedSystem = (typeof SUPPORTED_SYSTEMS)[number];

const JSON_INDENT = 2;
const PACKAGE_VERSION_FIELD = "version";
const WRAPPED_BINARY_VERSION_FIELD = "binaryVersion";
const SINGLE_PACKAGE_ARTIFACT_HASH_FIELD = "packageHash";
const PLATFORM_PACKAGE_ARTIFACT_HASHES_FIELD = "platformPackageHashes";
const AUXILIARY_UPSTREAM_SOURCE_HASH_FIELD = "sourceHash";
const RUST_DEPENDENCY_VENDOR_HASH_FIELD = "cargoVendorHash";
const NPM_DEPENDENCY_VENDOR_HASH_FIELD = "npmVendorHash";

const VERSION_IDENTITY_FIELDS = [
  PACKAGE_VERSION_FIELD,
  WRAPPED_BINARY_VERSION_FIELD,
] as const satisfies readonly string[];

const UPSTREAM_ARTIFACT_HASH_FIELDS = [
  SINGLE_PACKAGE_ARTIFACT_HASH_FIELD,
  PLATFORM_PACKAGE_ARTIFACT_HASHES_FIELD,
  AUXILIARY_UPSTREAM_SOURCE_HASH_FIELD,
] as const satisfies readonly string[];

const PLATFORM_ARTIFACT_HASH_FIELDS = SUPPORTED_SYSTEMS;

const GENERATED_DEPENDENCY_HASH_FIELDS = [
  RUST_DEPENDENCY_VENDOR_HASH_FIELD,
  NPM_DEPENDENCY_VENDOR_HASH_FIELD,
] as const satisfies readonly string[];

const JSON_FIELD_ORDER = [
  ...VERSION_IDENTITY_FIELDS,
  ...UPSTREAM_ARTIFACT_HASH_FIELDS,
  ...PLATFORM_ARTIFACT_HASH_FIELDS,
  ...GENERATED_DEPENDENCY_HASH_FIELDS,
] as const satisfies readonly string[];

interface PinJsonConfig {
  readonly binaryVersion?: string;
  readonly cargoVendorHash?: string;
  readonly npmVendorHash?: string;
  readonly packageHash?: string;
  readonly platformPackageHashes?: Readonly<Record<SupportedSystem, string>>;
  readonly sourceHash?: string;
  readonly version: string;
}

function serializePinJson(config: PinJsonConfig): string {
  return `${JSON.stringify(config, [...JSON_FIELD_ORDER], JSON_INDENT)}\n`;
}

function writePinJson(path: string, config: PinJsonConfig): Effect.Effect<void> {
  return writeTextFile(path, serializePinJson(config));
}

function serializePackageHashConfig(config: PackageHashConfig): string {
  return serializePinJson(config);
}

function writePackageHashConfig(path: string, config: PackageHashConfig): Effect.Effect<void> {
  return writePinJson(path, config);
}

export { serializePackageHashConfig, serializePinJson, writePackageHashConfig, writePinJson };
export type { PinJsonConfig };
