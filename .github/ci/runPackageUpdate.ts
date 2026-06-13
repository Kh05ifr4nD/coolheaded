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
import { compareVersions } from "coolheaded/version.ts";

const PACKAGE_UPDATE_ALLOWED_FILES_EXPR = `
let
  config = builtins.fromJSON (builtins.getEnv "PACKAGE_UPDATE_CONFIG");
  flake = builtins.getFlake (toString ./.);
  package = flake.packages.\${config.system}.\${config.name};
in
  package.passthru.updateAllowedFiles or []
`;

function isStringList(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((item: unknown): boolean => typeof item === "string");
}

function parseStringList(value: unknown): readonly string[] {
  if (!isStringList(value)) {
    throw new Error("Invalid package update allowed files JSON");
  }

  return value;
}

async function packageUpdateAllowedFiles(system: string, name: string): Promise<readonly string[]> {
  const result = await run(
    ["nix", "eval", "--json", "--impure", "--expr", PACKAGE_UPDATE_ALLOWED_FILES_EXPR],
    {
      capture: true,
      env: {
        PACKAGE_UPDATE_CONFIG: JSON.stringify({ name, system }),
      },
    },
  );
  const parsed: unknown = JSON.parse(result.stdout);
  return parseStringList(parsed);
}

function packageAllowedFile(name: string, extraFiles: readonly string[], file: string): boolean {
  return file.startsWith(`packages/${name}/`) || extraFiles.includes(file);
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
  const extraAllowedFiles = await packageUpdateAllowedFiles(system, name);
  const files = await changedFiles();
  assertOnlyChangedFiles(files, (file: string): boolean =>
    packageAllowedFile(name, extraAllowedFiles, file),
  );

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
