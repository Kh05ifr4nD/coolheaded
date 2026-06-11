#!/usr/bin/env -S deno run --allow-env --allow-read --allow-run

import { run, writeOutput } from "./lib.ts";

const BUILD_ALL_SENTINEL = "__all__";
const PACKAGE_INFRASTRUCTURE_PATHS = new Set(["flake.lock", "flake.nix", "packages/.gitignore"]);
const SYSTEMS = [
  { runner: "ubuntu-24.04", system: "x86_64-linux" },
  { runner: "ubuntu-24.04-arm", system: "aarch64-linux" },
  { runner: "macos-26", system: "aarch64-darwin" },
] as const;

interface BuildTarget {
  readonly package: string;
  readonly runner: string;
  readonly system: string;
}

function packagesFromInput(value: string | undefined): readonly string[] {
  return [
    ...new Set((value ?? "").split(" ").filter((name: string): boolean => name.length > 0)),
  ].toSorted();
}

function changedPackageNames(
  files: readonly string[],
): readonly string[] | typeof BUILD_ALL_SENTINEL {
  const packages = new Set<string>();
  for (const file of files) {
    if (
      PACKAGE_INFRASTRUCTURE_PATHS.has(file) ||
      file.startsWith("flake/") ||
      file.startsWith("lib/")
    ) {
      return BUILD_ALL_SENTINEL;
    }

    if (file.startsWith("packages/")) {
      const [, name] = file.split("/");
      if (name !== undefined && name.length > 0) {
        packages.add(name);
      }
    }
  }

  return [...packages].toSorted();
}

async function changedFiles(baseSha: string): Promise<readonly string[]> {
  const result = await run(["git", "diff", "--name-only", `${baseSha}...HEAD`], { capture: true });
  return result.stdout.split("\n").filter((file: string): boolean => file.length > 0);
}

async function availablePackages(system: string): Promise<readonly string[]> {
  const result = await run(
    [
      "nix",
      "eval",
      "--json",
      `.#checks.${system}`,
      "--apply",
      'checks: builtins.attrNames (builtins.removeAttrs checks [ "pre-commit" "treefmt" ])',
    ],
    { capture: true },
  );
  const value = JSON.parse(result.stdout);
  if (
    !Array.isArray(value) ||
    !value.every((name: unknown): name is string => typeof name === "string")
  ) {
    throw new Error(`Unexpected package list for ${system}`);
  }

  return value.toSorted();
}

function missingPackages(
  requested: readonly string[],
  availableBySystem: Readonly<Record<string, readonly string[]>>,
): readonly string[] {
  const available = new Set(Object.values(availableBySystem).flat());
  return requested.filter((name: string): boolean => !available.has(name));
}

function buildMatrix(
  requested: readonly string[],
  availableBySystem: Readonly<Record<string, readonly string[]>>,
): readonly BuildTarget[] {
  return SYSTEMS.flatMap((target): readonly BuildTarget[] => {
    const availableForSystem = availableBySystem[target.system];
    const available = new Set(availableForSystem);
    return requested
      .filter((name: string): boolean => available.has(name))
      .map(
        (name: string): BuildTarget => ({
          package: name,
          runner: target.runner,
          system: target.system,
        }),
      );
  });
}

async function requestedPackages(
  eventName: string | undefined,
  baseSha: string | undefined,
  packagesInput: string | undefined,
  buildAllPackages: string | undefined,
  availableBySystem: Readonly<Record<string, readonly string[]>>,
): Promise<readonly string[]> {
  if (buildAllPackages === "true") {
    return [...new Set(Object.values(availableBySystem).flat())].toSorted();
  }

  const explicit = packagesFromInput(packagesInput);
  if (explicit.length > 0) {
    return explicit;
  }

  if (eventName === "pull_request" && baseSha !== undefined && baseSha.length > 0) {
    const changed = changedPackageNames(await changedFiles(baseSha));
    return changed === BUILD_ALL_SENTINEL
      ? [...new Set(Object.values(availableBySystem).flat())].toSorted()
      : changed;
  }

  return [];
}

async function discoverCiPackageBuilds(): Promise<void> {
  const availableBySystem = Object.fromEntries(
    await Promise.all(
      SYSTEMS.map(
        async (target): Promise<readonly [string, readonly string[]]> => [
          target.system,
          await availablePackages(target.system),
        ],
      ),
    ),
  );

  const requested = await requestedPackages(
    Deno.env.get("GITHUB_EVENT_NAME"),
    Deno.env.get("BASE_SHA"),
    Deno.env.get("PACKAGES"),
    Deno.env.get("BUILD_ALL_PACKAGES"),
    availableBySystem,
  );
  const missing = missingPackages(requested, availableBySystem);
  if (missing.length > 0) {
    throw new Error(`Unknown check attrs: ${missing.join(", ")}`);
  }

  const include = buildMatrix(requested, availableBySystem);
  await writeOutput("hasPackages", String(include.length > 0));
  await writeOutput("matrix", JSON.stringify({ include }));
}

if (import.meta.main) {
  void discoverCiPackageBuilds();
}

export { buildMatrix, changedPackageNames, packagesFromInput, requestedPackages };
