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
import { generatedNpmPackageLock } from "coolheaded/npm/lock.ts";
import { latestGitHubVersion } from "coolheaded/source/version.ts";
import { writePinJson } from "coolheaded/pin/json.ts";

const PIN_FILE_PATH = scriptPath("pin.json", import.meta.url);
const REPOSITORY_ROOT_PATH = scriptPath("../../", import.meta.url);
const GITHUB_SOURCE = {
  owner: "getpaseo",
  repo: "paseo",
  tag: (version: string): string => `v${version}`,
};

function latestVersion(): Effect.Effect<string, Error> {
  return latestGitHubVersion({
    owner: GITHUB_SOURCE.owner,
    repo: GITHUB_SOURCE.repo,
  });
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

function updateProgram(args: readonly string[], runner: CommandRunner): Effect.Effect<void, Error> {
  return updateNewerPinVersion(
    args,
    latestVersion,
    PIN_FILE_PATH,
    (version: string): Effect.Effect<void, Error> => writeUpdatedPin(version, runner),
  );
}

async function main(args: readonly string[], runner: CommandRunner): Promise<void> {
  await Effect.runPromise(updateProgram(args, runner));
}

runUpdateScript(import.meta.url, updateProgram);

export { main };
