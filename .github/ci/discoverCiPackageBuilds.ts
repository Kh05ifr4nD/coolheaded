#!/usr/bin/env -S deno run --allow-env --allow-read --allow-run

import { run, writeOutput } from "./lib.ts";
import { SYSTEM_TARGETS } from "coolheaded/system.ts";
import { toFileUrl } from "@jsr/std__path";

const PACKAGE_CHECKS_EXPR =
  'checks: builtins.mapAttrs (_: check: builtins.unsafeDiscardStringContext check.drvPath) (builtins.removeAttrs checks [ "pre-commit" "treefmt" ])';

interface BuildTarget {
  readonly package: string;
  readonly runner: string;
  readonly system: string;
}

type PackageDrvPaths = Readonly<Record<string, string>>;
type PackageDrvPathsBySystem = Readonly<Record<string, PackageDrvPaths>>;
type SystemTarget = (typeof SYSTEM_TARGETS)[number];

function packagesFromInput(value: string | undefined): readonly string[] {
  return [
    ...new Set((value ?? "").split(" ").filter((name: string): boolean => name.length > 0)),
  ].toSorted();
}

function localGitFlakeRef(rev: string): string {
  return `git+${toFileUrl(Deno.cwd()).href}?rev=${encodeURIComponent(rev)}`;
}

async function checkedOutBaseFlakeRef(): Promise<string> {
  const result = await run(["git", "rev-parse", "HEAD^1"], { capture: true });
  return localGitFlakeRef(result.stdout);
}

async function packageDrvPaths(flakeRef: string, system: string): Promise<PackageDrvPaths> {
  const result = await run(
    ["nix", "eval", "--json", `${flakeRef}#checks.${system}`, "--apply", PACKAGE_CHECKS_EXPR],
    { capture: true },
  );
  const value = JSON.parse(result.stdout);
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`Unexpected package drvPath map for ${system}`);
  }

  const entries: [string, string][] = [];
  for (const [name, drvPath] of Object.entries(value)) {
    if (typeof drvPath !== "string") {
      throw new TypeError(`Unexpected drvPath for ${system}.${name}`);
    }
    entries.push([name, drvPath]);
  }

  return Object.fromEntries(entries);
}

async function packageDrvPathsBySystem(flakeRef: string): Promise<PackageDrvPathsBySystem> {
  return Object.fromEntries(
    await Promise.all(
      SYSTEM_TARGETS.map(
        async (target: SystemTarget): Promise<readonly [string, PackageDrvPaths]> => [
          target.system,
          await packageDrvPaths(flakeRef, target.system),
        ],
      ),
    ),
  );
}

function availablePackagesBySystem(
  drvPathsBySystem: PackageDrvPathsBySystem,
): Readonly<Record<string, readonly string[]>> {
  return Object.fromEntries(
    Object.entries(drvPathsBySystem).map(
      (entry: readonly [string, PackageDrvPaths]): readonly [string, readonly string[]] => {
        const [system, drvPaths] = entry;
        return [system, Object.keys(drvPaths).toSorted()];
      },
    ),
  );
}

function changedDerivationPackages(
  before: PackageDrvPaths,
  after: PackageDrvPaths,
): readonly string[] {
  return Object.keys(after)
    .filter((name: string): boolean => before[name] !== after[name])
    .toSorted();
}

function changedDerivationTargets(
  beforeBySystem: Readonly<PackageDrvPathsBySystem>,
  afterBySystem: Readonly<PackageDrvPathsBySystem>,
): readonly BuildTarget[] {
  return SYSTEM_TARGETS.flatMap((target: SystemTarget): readonly BuildTarget[] =>
    changedDerivationPackages(
      beforeBySystem[target.system] ?? {},
      afterBySystem[target.system] ?? {},
    ).map(
      (name: string): BuildTarget => ({
        package: name,
        runner: target.runner,
        system: target.system,
      }),
    ),
  );
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
  return SYSTEM_TARGETS.flatMap((target: SystemTarget): readonly BuildTarget[] => {
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

function comparesCheckedOutBase(eventName?: string): boolean {
  return eventName === "merge_group" || eventName === "pull_request";
}

async function requestedBuildTargets(
  eventName: string | undefined,
  packagesInput: string | undefined,
  buildAllPackages: string | undefined,
  availableBySystem: Readonly<Record<string, readonly string[]>>,
  currentDrvPathsBySystem: PackageDrvPathsBySystem,
): Promise<readonly BuildTarget[]> {
  if (buildAllPackages === "true") {
    return buildMatrix(
      [...new Set(Object.values(availableBySystem).flat())].toSorted(),
      availableBySystem,
    );
  }

  const explicit = packagesFromInput(packagesInput);
  if (explicit.length > 0) {
    const missing = missingPackages(explicit, availableBySystem);
    if (missing.length > 0) {
      throw new Error(`Unknown check attrs: ${missing.join(", ")}`);
    }
    return buildMatrix(explicit, availableBySystem);
  }

  if (comparesCheckedOutBase(eventName)) {
    return changedDerivationTargets(
      await packageDrvPathsBySystem(await checkedOutBaseFlakeRef()),
      currentDrvPathsBySystem,
    );
  }

  return [];
}

async function discoverCiPackageBuilds(): Promise<void> {
  const currentDrvPathsBySystem = await packageDrvPathsBySystem(".");
  const availableBySystem = availablePackagesBySystem(currentDrvPathsBySystem);

  const include = await requestedBuildTargets(
    Deno.env.get("GITHUB_EVENT_NAME"),
    Deno.env.get("PACKAGES"),
    Deno.env.get("BUILD_ALL_PACKAGES"),
    availableBySystem,
    currentDrvPathsBySystem,
  );

  await writeOutput("hasPackages", String(include.length > 0));
  await writeOutput("matrix", JSON.stringify({ include }));
}

if (import.meta.main) {
  void discoverCiPackageBuilds();
}

export {
  buildMatrix,
  changedDerivationPackages,
  changedDerivationTargets,
  comparesCheckedOutBase,
  packagesFromInput,
  requestedBuildTargets,
};
export { SYSTEM_TARGETS } from "coolheaded/system.ts";
