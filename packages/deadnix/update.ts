import { runUpdateScript, scriptPath } from "coolheaded/core/updateScript.ts";
import type { CommandRunner } from "coolheaded/core/commandRunner.ts";
import { Effect } from "effect";
import { latestGitHubVersion } from "coolheaded/source/version.ts";
import { updateGitHubRustPackagePin } from "coolheaded/update/rustPackage.ts";

const PIN_FILE_PATH = scriptPath("pin.json", import.meta.url);
const REPOSITORY_ROOT_PATH = scriptPath("../../", import.meta.url);
const PACKAGE = {
  owner: "astro",
  pname: "deadnix",
  repo: "deadnix",
  tag: (version: string): string => `v${version}`,
} as const;

function latestVersion(): Effect.Effect<string, Error> {
  return latestGitHubVersion({
    owner: PACKAGE.owner,
    repo: PACKAGE.repo,
  });
}

function updateProgram(args: readonly string[], runner: CommandRunner): Effect.Effect<void, Error> {
  return updateGitHubRustPackagePin({
    args,
    latestVersion,
    package: PACKAGE,
    pinFilePath: PIN_FILE_PATH,
    repositoryRootPath: REPOSITORY_ROOT_PATH,
    runner,
  });
}

async function main(args: readonly string[], runner: CommandRunner): Promise<void> {
  await Effect.runPromise(updateProgram(args, runner));
}

runUpdateScript(import.meta.url, updateProgram);

export { main };
