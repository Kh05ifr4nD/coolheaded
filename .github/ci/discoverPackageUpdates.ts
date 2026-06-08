#!/usr/bin/env -S deno run --allow-env --allow-run --allow-write

import { currentSystem, isRecord, run, writeOutput } from "./lib.ts";

interface MatrixItem {
  readonly currentVersion: string;
  readonly name: string;
}

const NIX_EXPR = `
let
  config = builtins.fromJSON (builtins.getEnv "DISCOVERY_CONFIG");
  flake = builtins.getFlake (toString ./.);
  packages = flake.packages.\${config.system};
  isUpdatable = package:
    package ? version && ((package.passthru or { }) ? updateScript);
  getVersion = name:
    if packages ? \${name} && isUpdatable packages.\${name}
    then { inherit name; value = packages.\${name}.version; }
    else null;
in
  if config.filter == null then
    builtins.mapAttrs (
      _name: package: if isUpdatable package then package.version else null
    ) packages
  else
    builtins.listToAttrs
      (builtins.filter (item: item != null) (map getVersion config.filter))
`;

function filteredNames(): readonly string[] | null {
  const packages = Deno.env.get("PACKAGES")?.trim();
  return packages === undefined || packages.length === 0 ? null : packages.split(/\s+/u);
}

async function discoverPackageUpdates(): Promise<readonly MatrixItem[]> {
  const config = JSON.stringify({
    filter: filteredNames(),
    system: await currentSystem(),
  });
  const result = await run(["nix", "eval", "--json", "--impure", "--expr", NIX_EXPR], {
    capture: true,
    env: { DISCOVERY_CONFIG: config },
  });
  const parsedVersions: unknown = JSON.parse(result.stdout);
  if (!isRecord(parsedVersions)) {
    throw new Error("Invalid package discovery JSON");
  }

  return Object.entries(parsedVersions)
    .flatMap((entry: readonly [string, unknown]): readonly MatrixItem[] => {
      const [name, currentVersion] = entry;
      return typeof currentVersion === "string" ? [{ currentVersion, name }] : [];
    })
    .toSorted((left: Readonly<MatrixItem>, right: Readonly<MatrixItem>): number =>
      left.name.localeCompare(right.name),
    );
}

async function main(): Promise<void> {
  const include = await discoverPackageUpdates();
  await writeOutput("matrix", JSON.stringify({ include }));
  await writeOutput("hasUpdates", String(include.length > 0));
}

if (import.meta.main) {
  void main();
}

export { discoverPackageUpdates };
