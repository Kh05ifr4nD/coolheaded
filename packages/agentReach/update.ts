import { runUpdateScript, scriptPath } from "coolheaded/core/updateScript.ts";
import type { CommandRunner } from "coolheaded/core/commandRunner.ts";
import type { Effect } from "effect";
import type { JsonClient } from "coolheaded/core/httpClient.ts";
import { fetchJsonClient } from "coolheaded/core/fetchHttpClient.ts";
import { latestGitHubVersion } from "coolheaded/source/githubVersion.ts";
import { updateGitHubSourcePin } from "coolheaded/source/github.ts";

const PIN_FILE_PATH = scriptPath("pin.json", import.meta.url);
const REPOSITORY_ROOT_PATH = scriptPath("../../", import.meta.url);
const SOURCE = {
  owner: "Panniantong",
  repo: "Agent-Reach",
  tag: (version: string): string => `v${version}`,
};

function latestVersion(jsonClient: JsonClient): ReturnType<typeof latestGitHubVersion> {
  return latestGitHubVersion({ owner: SOURCE.owner, repo: SOURCE.repo }, jsonClient);
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
    source: SOURCE,
  });
}

function cliProgram(args: readonly string[], runner: CommandRunner): Effect.Effect<void, Error> {
  return updateProgram(args, runner, fetchJsonClient);
}

runUpdateScript(import.meta.url, cliProgram);

export { updateProgram };
