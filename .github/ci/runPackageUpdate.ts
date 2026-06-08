#!/usr/bin/env -S deno run --allow-env --allow-read --allow-run --allow-write

import {
  assertOnlyChangedFiles,
  changedFiles,
  currentSystem,
  gitHasChanges,
  nixEvalRaw,
  run,
  writeOutput,
} from "./lib.ts";

function packageAllowedFile(name: string, file: string): boolean {
  return file.startsWith(`packages/${name}/`);
}

async function runPackageUpdate(name: string, version?: string): Promise<void> {
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

  const files = await changedFiles();
  assertOnlyChangedFiles(files, (file: string): boolean => packageAllowedFile(name, file));

  const system = await currentSystem();
  const attr = `.#packages.${system}.${name}`;
  await writeOutput("updated", "true");
  await writeOutput("newVersion", await nixEvalRaw(`${attr}.version`));
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
