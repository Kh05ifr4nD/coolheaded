#!/usr/bin/env -S deno run --allow-env --allow-read --allow-run --allow-write

import { DENO_DEPENDENCY_HASH_FILE_PATH, updateDenoDependencyHash } from "./runDenoDepsUpdate.ts";
import {
  assertOnlyChangedFiles,
  changedFiles,
  currentSystem,
  gitHasChanges,
  nixEvalRaw,
  run,
  writeOutput,
} from "./lib.ts";
import { compareVersions } from "coolheaded/version.ts";

function packageAllowedFile(name: string, file: string): boolean {
  return (
    file.startsWith(`packages/${name}/`) ||
    (name === "deno" && file === DENO_DEPENDENCY_HASH_FILE_PATH)
  );
}

function assertVersionAdvanced(
  name: string,
  currentVersion: string | undefined,
  newVersion: string,
): void {
  if (
    currentVersion !== undefined &&
    currentVersion.length > 0 &&
    compareVersions(currentVersion, newVersion) >= 0
  ) {
    throw new Error(
      `${name} produced package changes without a version advance: ${currentVersion} -> ${newVersion}`,
    );
  }
}

async function runPackageUpdate(
  name: string,
  version?: string,
  currentVersion = Deno.env.get("CURRENT_VERSION"),
): Promise<void> {
  await run(
    [
      "deno",
      "run",
      "--allow-env",
      "--allow-net",
      "--allow-read",
      "--allow-run",
      "--allow-write",
      `packages/${name}/update.ts`,
      ...(version === undefined ? [] : [version]),
    ],
    { capture: false },
  );

  if (!(await gitHasChanges())) {
    await writeOutput("updated", "false");
    return;
  }

  const system = await currentSystem();
  if (name === "deno") {
    await updateDenoDependencyHash(system);
  }
  const files = await changedFiles();
  assertOnlyChangedFiles(files, (file: string): boolean => packageAllowedFile(name, file));

  const attr = `.#packages.${system}.${name}`;
  const newVersion = await nixEvalRaw(`${attr}.version`);
  assertVersionAdvanced(name, currentVersion, newVersion);

  await writeOutput("updated", "true");
  await writeOutput("newVersion", newVersion);
  const changelog = await run(["nix", "eval", "--raw", `${attr}.meta.changelog`], {
    capture: true,
    check: false,
  });
  await writeOutput("changelog", changelog.code === 0 ? changelog.stdout : "");
}

async function main(args: readonly string[]): Promise<void> {
  const [name, version] = args;
  if (name === undefined || name.length === 0) {
    throw new Error("Usage: runPackageUpdate.ts <name> [version]");
  }

  await runPackageUpdate(name, version);
}

if (import.meta.main) {
  void main(Deno.args);
}

export { runPackageUpdate };
