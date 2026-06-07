#!/usr/bin/env -S deno run --allow-env --allow-read --allow-run --allow-write

import {
  assertOnlyChangedFiles,
  changedFiles,
  gitHasChanges,
  isRecord,
  readJson,
  run,
  writeOutput,
} from "./lib.ts";

function directSpecifierVersions(
  lock: unknown,
): Readonly<Record<string, string>> {
  if (!isRecord(lock) || !isRecord(lock["specifiers"])) {
    return {};
  }

  const versions: Record<string, string> = {};
  for (const [specifier, version] of Object.entries(lock["specifiers"])) {
    if (typeof version === "string") {
      versions[specifier] = version;
    }
  }

  return versions;
}

function versionChanges(
  before: Readonly<Record<string, string>>,
  after: Readonly<Record<string, string>>,
): string {
  const changes: string[] = [];
  for (const [specifier, version] of Object.entries(after)) {
    const oldVersion = before[specifier];
    if (oldVersion !== version) {
      changes.push(`${specifier}: ${oldVersion ?? "missing"} -> ${version}`);
    }
  }

  return changes.join("\n");
}

async function runDenoDepsUpdate(): Promise<void> {
  const before = directSpecifierVersions(await readJson("deno.lock"));
  await run(["deno", "install", "--frozen=false"], { capture: false });

  if (!await gitHasChanges(["deno.lock"])) {
    await writeOutput("updated", "false");
    return;
  }

  assertOnlyChangedFiles(
    await changedFiles(),
    (file: string): boolean => file === "deno.lock",
  );
  const after = directSpecifierVersions(await readJson("deno.lock"));
  await writeOutput("updated", "true");
  await writeOutput("newVersion", "deno.lock");
  await writeOutput("changelog", versionChanges(before, after));
}

async function main(): Promise<void> {
  await runDenoDepsUpdate();
}

if (import.meta.main) {
  void main();
}

export { directSpecifierVersions, runDenoDepsUpdate, versionChanges };
