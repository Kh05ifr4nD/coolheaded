import type { SupportedSystem } from "./system.ts";

interface PackageHashConfig {
  readonly binaryVersion?: string;
  readonly platformPackageHashes: Readonly<Record<SupportedSystem, string>>;
  readonly version: string;
}

export type { PackageHashConfig };
