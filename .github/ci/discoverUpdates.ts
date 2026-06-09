#!/usr/bin/env -S deno run --allow-env --allow-read --allow-run --allow-write

import { discoverFlakeInputUpdates } from "./discoverFlakeInputUpdates.ts";
import { discoverPackageUpdates } from "./discoverPackageUpdates.ts";
import { writeOutput } from "./lib.ts";

type UpdateType = "deno-deps" | "flake-input" | "package";

interface BaseUpdate {
  readonly currentVersion: string;
  readonly name: string;
  readonly type: UpdateType;
}

function enabled(name: string): boolean {
  return Deno.env.get(name) !== "false";
}

async function discoverUpdates(): Promise<readonly BaseUpdate[]> {
  const packageUpdates = enabled("UPDATE_PACKAGES") ? await discoverPackageUpdates() : [];
  const flakeInputUpdates = enabled("UPDATE_FLAKE_INPUTS") ? await discoverFlakeInputUpdates() : [];
  const updates = [
    ...packageUpdates.map(
      (item): BaseUpdate => ({
        currentVersion: item.currentVersion,
        name: item.name,
        type: "package",
      }),
    ),
    ...flakeInputUpdates.map(
      (item): BaseUpdate => ({
        currentVersion: item.currentVersion,
        name: item.name,
        type: "flake-input",
      }),
    ),
    ...(enabled("UPDATE_DENO_DEPS")
      ? ([{ currentVersion: "deno.lock", name: "denoDeps", type: "deno-deps" }] satisfies [
          BaseUpdate,
        ])
      : []),
  ];

  return updates.toSorted((left: BaseUpdate, right: BaseUpdate): number =>
    left.type === right.type
      ? left.name.localeCompare(right.name)
      : left.type.localeCompare(right.type),
  );
}

async function main(): Promise<void> {
  const include = await discoverUpdates();
  await writeOutput("matrix", JSON.stringify({ include }));
  await writeOutput("hasUpdates", String(include.length > 0));
}

if (import.meta.main) {
  void main();
}

export { discoverUpdates };
export type { BaseUpdate, UpdateType };
