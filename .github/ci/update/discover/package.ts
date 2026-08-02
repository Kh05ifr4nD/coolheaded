#!/usr/bin/env -S deno run --allow-env --allow-run --allow-write

import { currentSystem, isRecord, run, writeOutput } from "coolheadedCi/process.ts";
import type { CommandRunner } from "coolheaded/core/commandRunner.ts";
import type { VersionSchemeName } from "coolheaded/core/version.ts";
import { denoCommandRunner } from "coolheaded/core/denoCommandRunner.ts";

interface MatrixItem {
  readonly currentVersion: string;
  readonly name: string;
  readonly versionScheme: VersionSchemeName;
}

const NIX_EXPR = `
let
  config = builtins.fromJSON (builtins.getEnv "DISCOVERY_CONFIG");
  flake = builtins.getFlake (toString ./.);
  packages = flake.packages.\${config.system};
  isUpdatable = package:
    package ? version && ((package.passthru or { }) ? updateScript);
  getVersionScheme = package:
    (package.passthru or { }).updateVersionScheme or "semver";
  getVersion = name:
    let
      package = builtins.getAttr name packages;
    in
    if builtins.hasAttr name packages && isUpdatable package
    then {
      inherit name;
      value = {
        version = package.version;
        versionScheme = getVersionScheme package;
      };
    }
    else null;
in
  if config.filter == null then
    builtins.mapAttrs (
      _name: package:
      if isUpdatable package then {
        version = package.version;
        versionScheme = getVersionScheme package;
      } else null
    ) packages
  else
    builtins.listToAttrs
      (builtins.filter (item: item != null) (map getVersion config.filter))
`;

function filteredNames(): readonly string[] | null {
  const packages = Deno.env.get("PACKAGES")?.trim();
  return packages === undefined || packages.length === 0 ? null : packages.split(/\s+/u);
}

function isVersionSchemeName(value: unknown): value is VersionSchemeName {
  return value === "calendar" || value === "semver";
}

function packageUpdates(value: unknown): readonly MatrixItem[] {
  if (!isRecord(value)) {
    throw new Error("Invalid package discovery JSON");
  }

  return Object.entries(value)
    .flatMap((entry: readonly [string, unknown]): readonly MatrixItem[] => {
      const [name, item] = entry;
      if (!isRecord(item)) {
        return [];
      }
      const { version: currentVersion, versionScheme } = item;
      if (typeof currentVersion !== "string") {
        return [];
      }
      if (!isVersionSchemeName(versionScheme)) {
        throw new Error(`Invalid version scheme for package ${name}`);
      }
      return [{ currentVersion, name, versionScheme }];
    })
    .toSorted((left: Readonly<MatrixItem>, right: Readonly<MatrixItem>): number =>
      left.name.localeCompare(right.name),
    );
}

async function discoverPackage(
  runner: CommandRunner,
  filter: readonly string[] | null,
): Promise<readonly MatrixItem[]> {
  const config = JSON.stringify({
    filter,
    system: await currentSystem(runner),
  });
  const result = await run(runner, ["nix", "eval", "--json", "--impure", "--expr", NIX_EXPR], {
    capture: true,
    env: { DISCOVERY_CONFIG: config },
  });
  return packageUpdates(JSON.parse(result.stdout));
}

async function main(): Promise<void> {
  const include = await discoverPackage(denoCommandRunner, filteredNames());
  await writeOutput("matrix", JSON.stringify({ include }));
  await writeOutput("hasUpdates", String(include.length > 0));
}

if (import.meta.main) {
  void main();
}

export { NIX_EXPR, discoverPackage, packageUpdates };
export type { MatrixItem };
