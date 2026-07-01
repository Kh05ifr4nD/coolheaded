import { runUpdateScript, scriptPath } from "coolheaded/core/updateScript.ts";
import { Effect } from "effect";
import { latestGitHubVersion } from "coolheaded/sources/latestVersion.ts";
import { updateGitHubRustPackagePin } from "coolheaded/updates/rustPackage.ts";

const PIN_FILE_PATH = scriptPath("pin.json", import.meta.url);
const REPOSITORY_ROOT_PATH = scriptPath("../../", import.meta.url);
const PACKAGE = {
  owner: "rtk-ai",
  pname: "rtk",
  repo: "rtk",
  tag: (version: string): string => `v${version}`,
} as const;

function latestVersion(): Effect.Effect<string, Error> {
  return latestGitHubVersion({
    owner: PACKAGE.owner,
    repo: PACKAGE.repo,
  });
}

function updateProgram(args: readonly string[]): Effect.Effect<void, Error> {
  return updateGitHubRustPackagePin({
    args,
    latestVersion,
    package: PACKAGE,
    pinFilePath: PIN_FILE_PATH,
    repositoryRootPath: REPOSITORY_ROOT_PATH,
  });
}

async function main(args: readonly string[]): Promise<void> {
  await Effect.runPromise(updateProgram(args));
}

runUpdateScript(import.meta.url, updateProgram);

export { main };
