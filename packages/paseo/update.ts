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

interface UpdateDependencies {
  readonly jsonClient: JsonClient;
  readonly pinFilePath: string;
  readonly repositoryRootPath: string;
  readonly runner: CommandRunner;
}

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

function writeUpdatedPin(
  version: string,
  dependencies: Readonly<UpdateDependencies>,
): Effect.Effect<void, Error> {
  return Effect.gen(function* writeUpdatedPinSteps(): Effect.fn.Return<void, Error> {
    const { npmLock, sourceHash } = yield* Effect.all({
      npmLock: generatedNpmPackageLock({
        prepareWorkspace: (workspacePath: string): Effect.Effect<void, Error> =>
          prepareSourceWorkspace(workspacePath, version, dependencies.runner),
        repositoryRootPath: dependencies.repositoryRootPath,
        runner: dependencies.runner,
      }),
      sourceHash: fetchGitHubSourceHash(
        GITHUB_SOURCE,
        version,
        dependencies.repositoryRootPath,
        dependencies.runner,
      ),
    });

    yield* writePinJson(dependencies.pinFilePath, {
      npmVendorHash: npmLock.npmVendorHash,
      sourceHash: sourceHash.trim(),
      version,
    });
  });
}

function updateProgram(
  args: readonly string[],
  dependencies: Readonly<UpdateDependencies>,
): Effect.Effect<void, Error> {
  return updateNewerPinVersion(
    args,
    (): ReturnType<typeof latestVersion> => latestVersion(dependencies.jsonClient),
    dependencies.pinFilePath,
    (version: string): Effect.Effect<void, Error> => writeUpdatedPin(version, dependencies),
  );
}

async function main(
  args: readonly string[],
  dependencies: Readonly<UpdateDependencies>,
): Promise<void> {
  await Effect.runPromise(updateProgram(args, dependencies));
}

function cliProgram(args: readonly string[], runner: CommandRunner): Effect.Effect<void, Error> {
  return updateProgram(args, {
    jsonClient: fetchJsonClient,
    pinFilePath: PIN_FILE_PATH,
    repositoryRootPath: REPOSITORY_ROOT_PATH,
    runner,
  });
}

runUpdateScript(import.meta.url, cliProgram);

export { main, updateProgram };
export type { UpdateDependencies };
