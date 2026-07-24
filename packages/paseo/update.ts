import {
  fetchGitHubSourceHash,
  prepareGitHubTagTarballWorkspace,
} from "coolheaded/source/github.ts";
import {
  runUpdateScript,
  scriptPath,
  updateNewerPinVersion,
} from "coolheaded/core/updateScript.ts";
import type { CommandRunner } from "coolheaded/core/commandRunner.ts";
import { Effect } from "effect";
import type { JsonClient } from "coolheaded/core/httpClient.ts";
import { fetchJsonClient } from "coolheaded/core/fetchHttpClient.ts";
import { generatedNpmPackageLock } from "coolheaded/npm/lock.ts";
import { latestGitHubVersion } from "coolheaded/source/githubVersion.ts";
import { writePinJson } from "coolheaded/pin/json.ts";

const PIN_FILE_PATH = scriptPath("pin.json", import.meta.url);
const REPOSITORY_ROOT_PATH = scriptPath("../../", import.meta.url);
const GITHUB_SOURCE = {
  owner: "getpaseo",
  repo: "paseo",
  tag: (version: string): string => `v${version}`,
};

function latestVersion(jsonClient: JsonClient): ReturnType<typeof latestGitHubVersion> {
  return latestGitHubVersion({ owner: GITHUB_SOURCE.owner, repo: GITHUB_SOURCE.repo }, jsonClient);
}

function prepareSourceWorkspace(
  workspacePath: string,
  version: string,
  runner: CommandRunner,
): Effect.Effect<void, Error> {
  return prepareGitHubTagTarballWorkspace(GITHUB_SOURCE, workspacePath, version, runner);
}

function writeUpdatedPin(version: string, runner: CommandRunner): Effect.Effect<void, Error> {
  return Effect.gen(function* writeUpdatedPinSteps(): Effect.fn.Return<void, Error> {
    const { npmLock, sourceHash } = yield* Effect.all({
      npmLock: generatedNpmPackageLock({
        prepareWorkspace: (workspacePath: string): Effect.Effect<void, Error> =>
          prepareSourceWorkspace(workspacePath, version, runner),
        repositoryRootPath: REPOSITORY_ROOT_PATH,
        runner,
      }),
      sourceHash: fetchGitHubSourceHash(GITHUB_SOURCE, version, REPOSITORY_ROOT_PATH, runner),
    });

    yield* writePinJson(PIN_FILE_PATH, {
      npmVendorHash: npmLock.npmVendorHash,
      sourceHash: sourceHash.trim(),
      version,
    });
  });
}

function updateProgram(
  args: readonly string[],
  runner: CommandRunner,
  jsonClient: JsonClient,
): Effect.Effect<void, Error> {
  return updateNewerPinVersion(
    args,
    (): ReturnType<typeof latestVersion> => latestVersion(jsonClient),
    PIN_FILE_PATH,
    (version: string): Effect.Effect<void, Error> => writeUpdatedPin(version, runner),
  );
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
