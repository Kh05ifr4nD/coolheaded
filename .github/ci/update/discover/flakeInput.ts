#!/usr/bin/env -S deno run --allow-env --allow-read --allow-write

import { isRecord, readJson, writeOutput } from "coolheadedCi/process.ts";

interface MatrixItem {
  readonly currentVersion: string;
  readonly name: string;
}

function lockNodes(lock: unknown): Readonly<Record<string, unknown>> {
  if (!isRecord(lock) || !isRecord(lock["nodes"])) {
    return {};
  }

  return lock["nodes"];
}

function rootInputs(nodes: Readonly<Record<string, unknown>>): Readonly<Record<string, string>> {
  const { root } = nodes;
  if (!isRecord(root) || !isRecord(root["inputs"])) {
    return {};
  }

  const inputs: Record<string, string> = {};
  for (const [name, nodeName] of Object.entries(root["inputs"])) {
    if (typeof nodeName === "string") {
      inputs[name] = nodeName;
    }
  }

  return inputs;
}

function lockedRev(node: unknown): string {
  if (!isRecord(node) || !isRecord(node["locked"])) {
    return "unknown";
  }

  const { locked } = node;
  const { rev } = locked;
  return typeof rev === "string" ? rev.slice(0, 8) : "unknown";
}

function filteredNames(): readonly string[] | null {
  const inputs = Deno.env.get("INPUTS")?.trim();
  return inputs === undefined || inputs.length === 0 ? null : inputs.split(/\s+/u);
}

function flakeInputUpdates(lock: unknown, names: readonly string[] | null): readonly MatrixItem[] {
  const nodes = lockNodes(lock);
  const inputs = rootInputs(nodes);
  const selectedNames = names ?? Object.keys(inputs).toSorted();

  return selectedNames.flatMap((name: string): readonly MatrixItem[] => {
    const nodeName = inputs[name];
    const node = nodeName === undefined ? undefined : nodes[nodeName];
    if (node === undefined) {
      return [];
    }

    return [
      {
        currentVersion: lockedRev(node),
        name,
      },
    ];
  });
}

async function discoverFlakeInput(): Promise<readonly MatrixItem[]> {
  return flakeInputUpdates(await readJson("flake.lock"), filteredNames());
}

async function main(): Promise<void> {
  const include = await discoverFlakeInput();
  await writeOutput("matrix", JSON.stringify({ include }));
  await writeOutput("hasUpdates", String(include.length > 0));
}

if (import.meta.main) {
  void main();
}

export { discoverFlakeInput, flakeInputUpdates };
export type { MatrixItem };
