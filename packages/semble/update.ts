import { runUpdateScript, scriptPath } from "coolheaded/core/updateScript.ts";
import type { CommandRunner } from "coolheaded/core/commandRunner.ts";
import { Effect } from "effect";
import type { JsonClient } from "coolheaded/core/httpClient.ts";
import { fetchJsonClient } from "coolheaded/core/fetchHttpClient.ts";
import { latestGitHubVersion } from "coolheaded/source/githubVersion.ts";
import { updateGitHubSourcePin } from "coolheaded/source/github.ts";

const PIN_FILE_PATH = scriptPath("pin.json", import.meta.url);
const REPOSITORY_ROOT_PATH = scriptPath("../../", import.meta.url);
const GITHUB_SOURCE = {
  owner: "MinishLab",
  repo: "semble",
  tag: (version: string): string => `v${version}`,
};
function latestVersion(jsonClient: JsonClient): ReturnType<typeof latestGitHubVersion> {
  return latestGitHubVersion({ owner: GITHUB_SOURCE.owner, repo: GITHUB_SOURCE.repo }, jsonClient);
}

function updateProgram(
  args: readonly string[],
  runner: CommandRunner,
  jsonClient: JsonClient,
): Effect.Effect<void, Error> {
  return updateGitHubSourcePin({
    args,
    latestVersion: (): Effect.Effect<string, Error> => latestVersion(jsonClient),
    pinFilePath: PIN_FILE_PATH,
    repositoryRootPath: REPOSITORY_ROOT_PATH,
    runner,
    source: GITHUB_SOURCE,
  });
}

async function main(
  args: readonly string[],
  runner: CommandRunner,
  jsonClient: JsonClient,
): Promise<void> {
  await Effect.runPromise(updateProgram(args, runner, jsonClient));
}

function cliProgram(args: readonly string[], runner: CommandRunner): Effect.Effect<void, Error> {
  return updateProgram(args, runner, fetchJsonClient);
}

runUpdateScript(import.meta.url, cliProgram);

export { main };
