#!/usr/bin/env -S deno run --allow-env --allow-read --allow-run --allow-write

import type { CommandRunner } from "coolheaded/core/commandRunner.ts";
import type { UpdateLane } from "coolheadedCi/model.ts";
import { denoCommandRunner } from "coolheaded/core/denoCommandRunner.ts";
import { discoverFlakeInput } from "./discover/flakeInput.ts";
import { discoverPackage } from "./discover/package.ts";
import { writeOutput } from "coolheadedCi/process.ts";

function enabled(name: string): boolean {
  return Deno.env.get(name) !== "false";
}

async function discoverUpdateLanes(runner: CommandRunner): Promise<readonly UpdateLane[]> {
  const packageLanes = enabled("UPDATE_PACKAGES") ? await discoverPackage(runner) : [];
  const flakeInputLanes = enabled("UPDATE_FLAKE_INPUTS") ? await discoverFlakeInput() : [];
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
    ...(enabled("UPDATE_DENO_DEPENDENCIES")
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

async function main(): Promise<void> {
  const include = await discoverUpdateLanes(denoCommandRunner);
  await writeOutput("matrix", JSON.stringify({ include }));
  await writeOutput("hasUpdates", String(include.length > 0));
}

if (import.meta.main) {
  void main();
}

export { discoverUpdateLanes };
