import { runUpdateScript, scriptPath } from "coolheaded/core/updateScript.ts";
import type { CommandRunner } from "coolheaded/core/commandRunner.ts";
import { Effect } from "effect";
import { latestGitHubVersion } from "coolheaded/source/version.ts";
import { updateGitHubSourcePin } from "coolheaded/source/github.ts";

const PIN_FILE_PATH = scriptPath("pin.json", import.meta.url);
const REPOSITORY_ROOT_PATH = scriptPath("../../", import.meta.url);
const GITHUB_SOURCE = {
  owner: "MinishLab",
  repo: "semble",
  tag: (version: string): string => `v${version}`,
};
function latestVersion(): Effect.Effect<string, Error> {
  return latestGitHubVersion({
    owner: GITHUB_SOURCE.owner,
    repo: GITHUB_SOURCE.repo,
  });
}

function updateProgram(args: readonly string[], runner: CommandRunner): Effect.Effect<void, Error> {
  return updateGitHubSourcePin({
    args,
    latestVersion,
    pinFilePath: PIN_FILE_PATH,
    repositoryRootPath: REPOSITORY_ROOT_PATH,
    runner,
    source: GITHUB_SOURCE,
  });
}

async function main(args: readonly string[], runner: CommandRunner): Promise<void> {
  await Effect.runPromise(updateProgram(args, runner));
}

runUpdateScript(import.meta.url, updateProgram);

export { main };
