#!/usr/bin/env -S deno run --allow-env --allow-read --allow-run --allow-write

import {
  DENO_DEPS_HASH_FILE_PATH,
  buildDenoDepsCheck,
  isDenoDepsHashMismatch,
  updateDenoDepsHash,
} from "coolheaded/repo/denoDeps.ts";
import {
  assertOnlyChangedFiles,
  changedFiles,
  currentSystem,
  gitHasChanges,
  isRecord,
  readJson,
  run,
  writeOutput,
} from "./lib.ts";

async function lockedRevision(name: string): Promise<string> {
  const lock = await readJson("flake.lock");
  if (!isRecord(lock) || !isRecord(lock["nodes"])) {
    return "unknown";
  }

  const node = lock["nodes"][name];
  if (!isRecord(node) || !isRecord(node["locked"])) {
    return "unknown";
  }

  const { locked } = node;
  const { rev } = locked;
  return typeof rev === "string" ? rev.slice(0, 8) : "unknown";
}

async function repairDenoDepsHashIfNeeded(system: string): Promise<void> {
  const result = await buildDenoDepsCheck(system);

  if (result.code === 0) {
    return;
  }

  const output = `${result.stdout}\n${result.stderr}`;
  if (!isDenoDepsHashMismatch(output)) {
    throw new Error(output);
  }

  await updateDenoDepsHash(system);
}

async function runFlakeInputUpdate(name: string): Promise<void> {
  await run(["nix", "flake", "update", name], { capture: false });

  if (!(await gitHasChanges(["flake.lock"]))) {
    await writeOutput("updated", "false");
    return;
  }

  await repairDenoDepsHashIfNeeded(await currentSystem());

  assertOnlyChangedFiles(
    await changedFiles(),
    (file: string): boolean => file === "flake.lock" || file === DENO_DEPS_HASH_FILE_PATH,
  );
  await writeOutput("updated", "true");
  await writeOutput("newVersion", await lockedRevision(name));
  await writeOutput("changelog", "");
}

async function main(args: readonly string[]): Promise<void> {
  const [name] = args;
  if (name === undefined || name.length === 0) {
    throw new Error("Usage: runFlakeInputUpdate.ts <name>");
  }

  await runFlakeInputUpdate(name);
}

if (import.meta.main) {
  void main(Deno.args);
}

export { runFlakeInputUpdate };
