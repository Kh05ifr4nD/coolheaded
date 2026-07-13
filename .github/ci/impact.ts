#!/usr/bin/env -S deno run --allow-env --allow-read --allow-run

import { run, writeOutput, writeStderr } from "./process.ts";
import { SYSTEM_TARGETS } from "coolheaded/system/target.ts";
import { activatedCheck } from "./model.ts";
import { toFileUrl } from "@jsr/std__path";

const CHECK_DRV_PATHS_EXPR =
  'checks: builtins.mapAttrs (_: check: builtins.unsafeDiscardStringContext check.drvPath) (builtins.removeAttrs checks [ "pre-commit" "treefmt" ])';

type CheckDrvPaths = Readonly<Record<string, string>>;
type CheckDrvPathsBySystem = Readonly<Record<string, CheckDrvPaths>>;
type SystemTarget = (typeof SYSTEM_TARGETS)[number];
type ActivatedCheck = ReturnType<typeof activatedCheck>;

function checksFromInput(value: string | undefined): readonly string[] {
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

async function checkDrvPaths(flakeRef: string, system: string): Promise<CheckDrvPaths> {
  const result = await run(
    ["nix", "eval", "--json", `${flakeRef}#checks.${system}`, "--apply", CHECK_DRV_PATHS_EXPR],
    { capture: true },
  );
  const value = JSON.parse(result.stdout);
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`Unexpected check drvPath map for ${system}`);
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

async function checkDrvPathsBySystem(flakeRef: string): Promise<CheckDrvPathsBySystem> {
  return Object.fromEntries(
    await Promise.all(
      SYSTEM_TARGETS.map(
        async (target: SystemTarget): Promise<readonly [string, CheckDrvPaths]> => [
          target.system,
          await checkDrvPaths(flakeRef, target.system),
        ],
      ),
    ),
  );
}

function availableChecksBySystem(
  drvPathsBySystem: CheckDrvPathsBySystem,
): Readonly<Record<string, readonly string[]>> {
  return Object.fromEntries(
    Object.entries(drvPathsBySystem).map(
      (entry: readonly [string, CheckDrvPaths]): readonly [string, readonly string[]] => {
        const [system, drvPaths] = entry;
        return [system, Object.keys(drvPaths).toSorted()];
      },
    ),
  );
}

function changedDerivationChecks(before: CheckDrvPaths, after: CheckDrvPaths): readonly string[] {
  return Object.keys(after)
    .filter((name: string): boolean => before[name] !== after[name])
    .toSorted();
}

function changedActivatedChecks(
  beforeBySystem: Readonly<CheckDrvPathsBySystem>,
  afterBySystem: Readonly<CheckDrvPathsBySystem>,
): readonly ActivatedCheck[] {
  return SYSTEM_TARGETS.flatMap((target: SystemTarget): readonly ActivatedCheck[] =>
    changedDerivationChecks(
      beforeBySystem[target.system] ?? {},
      afterBySystem[target.system] ?? {},
    ).map((name: string): ActivatedCheck => activatedCheck(name, target.runner, target.system)),
  );
}

function missingChecks(
  requested: readonly string[],
  availableBySystem: Readonly<Record<string, readonly string[]>>,
): readonly string[] {
  const available = new Set(Object.values(availableBySystem).flat());
  return requested.filter((name: string): boolean => !available.has(name));
}

function buildMatrix(
  requested: readonly string[],
  availableBySystem: Readonly<Record<string, readonly string[]>>,
): readonly ActivatedCheck[] {
  return SYSTEM_TARGETS.flatMap((target: SystemTarget): readonly ActivatedCheck[] => {
    const availableForSystem = availableBySystem[target.system];
    const available = new Set(availableForSystem);
    return requested
      .filter((name: string): boolean => available.has(name))
      .map((name: string): ActivatedCheck => activatedCheck(name, target.runner, target.system));
  });
}

function changedFileCheckPrefix(file: string): string | null | undefined {
  const packageMatch = /^packages\/(?<prefix>[^/]+)\//u.exec(file);
  if (packageMatch?.groups?.["prefix"] !== undefined) {
    return packageMatch.groups["prefix"];
  }

  const homeModuleMatch = /^homeModules\/(?<prefix>[^/]+)\.nix$/u.exec(file);
  if (homeModuleMatch?.groups?.["prefix"] !== undefined) {
    return homeModuleMatch.groups["prefix"];
  }

  if (file === "fileSpec.cue" || file.startsWith(".github/") || file.startsWith("tests/")) {
    return null;
  }

  return undefined;
}

function checkBelongsToPrefix(name: string, prefix: string): boolean {
  return name === prefix || (name.startsWith(prefix) && /^[A-Z]/u.test(name.slice(prefix.length)));
}

function checksFromChangedFiles(
  files: readonly string[],
  availableBySystem: Readonly<Record<string, readonly string[]>>,
): readonly string[] {
  const available = [...new Set(Object.values(availableBySystem).flat())].toSorted();
  const prefixes = new Set<string>();

  for (const file of files) {
    const prefix = changedFileCheckPrefix(file);
    if (prefix === undefined) {
      return available;
    }
    if (prefix !== null) {
      prefixes.add(prefix);
    }
  }

  const requested = available.filter((name: string): boolean =>
    [...prefixes].some((prefix: string): boolean => checkBelongsToPrefix(name, prefix)),
  );
  const everyPrefixMatched = [...prefixes].every((prefix: string): boolean =>
    requested.some((name: string): boolean => checkBelongsToPrefix(name, prefix)),
  );
  return everyPrefixMatched ? requested : available;
}

async function checkedOutBaseChangedChecks(
  currentDrvPathsBySystem: CheckDrvPathsBySystem,
  availableBySystem: Readonly<Record<string, readonly string[]>>,
): Promise<readonly ActivatedCheck[]> {
  try {
    return changedActivatedChecks(
      await checkDrvPathsBySystem(await checkedOutBaseFlakeRef()),
      currentDrvPathsBySystem,
    );
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorSummary = errorMessage.trim().split("\n").at(-1) ?? errorMessage;
    await writeStderr(
      `Base check evaluation failed; falling back to changed-path impact: ${errorSummary}`,
    );
    const result = await run(["git", "diff", "--name-only", "HEAD^1", "HEAD", "--"], {
      capture: true,
    });
    const changedFiles = result.stdout
      .split("\n")
      .filter((file: string): boolean => file.length > 0);
    return buildMatrix(checksFromChangedFiles(changedFiles, availableBySystem), availableBySystem);
  }
}

function comparesCheckedOutBase(eventName?: string): boolean {
  return eventName === "merge_group" || eventName === "pull_request";
}

async function requestedActivatedChecks(
  eventName: string | undefined,
  checksInput: string | undefined,
  activateAllChecks: string | undefined,
  availableBySystem: Readonly<Record<string, readonly string[]>>,
  currentDrvPathsBySystem: CheckDrvPathsBySystem,
): Promise<readonly ActivatedCheck[]> {
  if (activateAllChecks === "true") {
    return buildMatrix(
      [...new Set(Object.values(availableBySystem).flat())].toSorted(),
      availableBySystem,
    );
  }

  const explicit = checksFromInput(checksInput);
  if (explicit.length > 0) {
    const missing = missingChecks(explicit, availableBySystem);
    if (missing.length > 0) {
      throw new Error(`Unknown checks.<system> attrs: ${missing.join(", ")}`);
    }
    return buildMatrix(explicit, availableBySystem);
  }

  if (comparesCheckedOutBase(eventName)) {
    return await checkedOutBaseChangedChecks(currentDrvPathsBySystem, availableBySystem);
  }

  return [];
}

async function discoverChangeImpact(): Promise<void> {
  const currentDrvPathsBySystem = await checkDrvPathsBySystem(".");
  const availableBySystem = availableChecksBySystem(currentDrvPathsBySystem);

  const include = await requestedActivatedChecks(
    Deno.env.get("GITHUB_EVENT_NAME"),
    Deno.env.get("CHECKS"),
    Deno.env.get("ACTIVATE_ALL_CHECKS"),
    availableBySystem,
    currentDrvPathsBySystem,
  );

  await writeOutput("hasActivatedChecks", String(include.length > 0));
  await writeOutput("matrix", JSON.stringify({ include }));
}

if (import.meta.main) {
  void discoverChangeImpact();
}

export {
  buildMatrix,
  changedActivatedChecks,
  changedDerivationChecks,
  checksFromChangedFiles,
  comparesCheckedOutBase,
  checksFromInput,
  requestedActivatedChecks,
};
export { SYSTEM_TARGETS } from "coolheaded/system/target.ts";
