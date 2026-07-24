#!/usr/bin/env -S deno run --allow-env --allow-read --allow-run --allow-write

import { readJson, writeOutput } from "coolheadedCi/process.ts";
import type { CommandRunner } from "coolheaded/core/commandRunner.ts";
import type { UpdateLane } from "coolheadedCi/model.ts";
import { denoCommandRunner } from "coolheaded/core/denoCommandRunner.ts";
import { discoverPackage } from "./discover/package.ts";
import { flakeInputUpdates } from "./discover/flakeInput.ts";

interface DiscoverySelection {
  readonly denoDependencies: boolean;
  readonly flakeInputNames: readonly string[] | null;
  readonly flakeInputs: boolean;
  readonly packageNames: readonly string[] | null;
  readonly packages: boolean;
}

type DiscoveryAction =
  | Readonly<{ readonly kind: "denoDependencies" }>
  | Readonly<{ readonly kind: "flakeInput"; readonly names: readonly string[] | null }>
  | Readonly<{ readonly kind: "package"; readonly names: readonly string[] | null }>;

interface DiscoveryState {
  readonly flakeInputLanes: readonly Readonly<{
    readonly currentVersion: string;
    readonly name: string;
  }>[];
  readonly includeDenoDependencies: boolean;
  readonly packageLanes: readonly Readonly<{
    readonly currentVersion: string;
    readonly name: string;
  }>[];
}

function enabled(name: string): boolean {
  return Deno.env.get(name) !== "false";
}

function filteredNames(name: string): readonly string[] | null {
  const value = Deno.env.get(name)?.trim();
  return value === undefined || value.length === 0 ? null : value.split(/\s+/u);
}

function discoveryPlan(selection: Readonly<DiscoverySelection>): readonly DiscoveryAction[] {
  return [
    ...(selection.packages
      ? ([{ kind: "package", names: selection.packageNames }] satisfies DiscoveryAction[])
      : []),
    ...(selection.flakeInputs
      ? ([{ kind: "flakeInput", names: selection.flakeInputNames }] satisfies DiscoveryAction[])
      : []),
    ...(selection.denoDependencies
      ? ([{ kind: "denoDependencies" }] satisfies DiscoveryAction[])
      : []),
  ];
}

function updateLanes(
  packageLanes: readonly Readonly<{ readonly currentVersion: string; readonly name: string }>[],
  flakeInputLanes: readonly Readonly<{ readonly currentVersion: string; readonly name: string }>[],
  includeDenoDependencies: boolean,
): readonly UpdateLane[] {
  const updates = [
    ...packageLanes.map(
      (item): UpdateLane => ({
        currentVersion: item.currentVersion,
        kind: "package",
        name: item.name,
      }),
    ),
    ...flakeInputLanes.map(
      (item): UpdateLane => ({
        currentVersion: item.currentVersion,
        kind: "flakeInput",
        name: item.name,
      }),
    ),
    ...(includeDenoDependencies
      ? ([
          { currentVersion: "deno.lock", kind: "denoDependencies", name: "denoDependencies" },
        ] satisfies [UpdateLane])
      : []),
  ];

  return updates.toSorted((left: UpdateLane, right: UpdateLane): number =>
    left.kind === right.kind
      ? left.name.localeCompare(right.name)
      : left.kind.localeCompare(right.kind),
  );
}

async function discoverUpdateLanes(
  plan: readonly DiscoveryAction[],
  runner: CommandRunner,
): Promise<readonly UpdateLane[]> {
  async function applyActions(
    remaining: readonly DiscoveryAction[],
    state: Readonly<DiscoveryState>,
  ): Promise<Readonly<DiscoveryState>> {
    const [action, ...rest] = remaining;
    if (action === undefined) {
      return state;
    }
    if (action.kind === "package") {
      return applyActions(rest, {
        ...state,
        packageLanes: await discoverPackage(runner, action.names),
      });
    }
    if (action.kind === "flakeInput") {
      return applyActions(rest, {
        ...state,
        flakeInputLanes: flakeInputUpdates(await readJson("flake.lock"), action.names),
      });
    }
    return applyActions(rest, { ...state, includeDenoDependencies: true });
  }
  const state = await applyActions(plan, {
    flakeInputLanes: [],
    includeDenoDependencies: false,
    packageLanes: [],
  });
  return updateLanes(state.packageLanes, state.flakeInputLanes, state.includeDenoDependencies);
}

async function main(): Promise<void> {
  const include = await discoverUpdateLanes(
    discoveryPlan({
      denoDependencies: enabled("UPDATE_DENO_DEPENDENCIES"),
      flakeInputNames: filteredNames("INPUTS"),
      flakeInputs: enabled("UPDATE_FLAKE_INPUTS"),
      packageNames: filteredNames("PACKAGES"),
      packages: enabled("UPDATE_PACKAGES"),
    }),
    denoCommandRunner,
  );
  await writeOutput("matrix", JSON.stringify({ include }));
  await writeOutput("hasUpdates", String(include.length > 0));
}

if (import.meta.main) {
  void main();
}

export { discoverUpdateLanes, discoveryPlan, updateLanes };
export type { DiscoveryAction, DiscoverySelection };
