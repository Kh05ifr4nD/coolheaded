#!/usr/bin/env -S deno run --allow-env --allow-read --allow-run --allow-write

import {
  DENO_SNAPSHOT_HASH_FILE_PATH,
  buildDenoSnapshotCheck,
  isDenoSnapshotHashMismatch,
  updateDenoSnapshotHash,
} from "coolheaded/repo/denoSnapshot.ts";
import {
  assertOnlyChangedFiles,
  changedFiles,
  currentSystem,
  gitHasChanges,
  isRecord,
  readJson,
  run,
  writeOutput,
} from "coolheadedCi/process.ts";

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

async function repairDenoSnapshotHashIfNeeded(system: string): Promise<void> {
  const result = await buildDenoSnapshotCheck(system);

  if (result.code === 0) {
    return;
  }

  const output = `${result.stdout}\n${result.stderr}`;
  if (!isDenoSnapshotHashMismatch(output)) {
    throw new Error(output);
  }

  await updateDenoSnapshotHash(system);
}

async function runFlakeInput(name: string): Promise<void> {
  await run(["nix", "flake", "update", name], { capture: false });

  if (!(await gitHasChanges(["flake.lock"]))) {
    await writeOutput("updated", "false");
    return;
  }

  await repairDenoSnapshotHashIfNeeded(await currentSystem());

  assertOnlyChangedFiles(
    await changedFiles(),
    (file: string): boolean => file === "flake.lock" || file === DENO_SNAPSHOT_HASH_FILE_PATH,
  );
  await writeOutput("updated", "true");
  await writeOutput("newVersion", await lockedRevision(name));
  await writeOutput("changelog", "");
}

async function main(args: readonly string[]): Promise<void> {
  const [name] = args;
  if (name === undefined || name.length === 0) {
    throw new Error("Usage: flakeInput.ts <name>");
  }

  await runFlakeInput(name);
}

if (import.meta.main) {
  void main(Deno.args);
}

export { runFlakeInput };
