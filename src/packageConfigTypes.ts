import type { SupportedSystem } from "./system.ts";

interface PackageHashConfig {
  readonly hashes: Readonly<Record<SupportedSystem, string>>;
  readonly version: string;
}

export type { PackageHashConfig };
