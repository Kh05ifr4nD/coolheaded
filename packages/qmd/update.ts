import {
  commandOutput,
  formatNixFile,
  runUpdateScript,
  scriptPath,
  updateNewerPinVersion,
  writeTextFile,
} from "coolheaded/core/updateScript.ts";
import {
  fetchGitHubSourceHash,
  prepareGitHubTagTarballWorkspace,
} from "coolheaded/source/github.ts";
import type { CommandRunner } from "coolheaded/core/commandRunner.ts";
import { Effect } from "effect";
import type { JsonClient } from "coolheaded/core/httpClient.ts";
import { fetchJsonClient } from "coolheaded/core/fetchHttpClient.ts";
import { latestGitHubVersion } from "coolheaded/source/githubVersion.ts";
import { withTemporaryDirectory } from "coolheaded/core/temporaryDirectory.ts";
import { writePinJson } from "coolheaded/pin/json.ts";

const GENERATED_PACKAGE_FILE_PATH = scriptPath("generatedPackage.nix", import.meta.url);
const PIN_FILE_PATH = scriptPath("pin.json", import.meta.url);
const REPOSITORY_ROOT_PATH = scriptPath("../../", import.meta.url);
const GITHUB_SOURCE = {
  owner: "tobi",
  repo: "qmd",
  tag: (version: string): string => `v${version}`,
};

function latestVersion(jsonClient: JsonClient): ReturnType<typeof latestGitHubVersion> {
  return latestGitHubVersion({ owner: GITHUB_SOURCE.owner, repo: GITHUB_SOURCE.repo }, jsonClient);
}

function bun2nixOutPath(runner: CommandRunner): Effect.Effect<string, Error> {
  return commandOutput(runner, "nix", [
    "build",
    "--no-link",
    "--print-out-paths",
    "--inputs-from",
    REPOSITORY_ROOT_PATH,
    "bun2nix#bun2nix",
  ]);
}

function generatedBunNixFromWorkspace(
  bun2nixPath: string,
  workspacePath: string,
  version: string,
  runner: CommandRunner,
): Effect.Effect<string, Error> {
  return Effect.gen(function* generatedBunNixFromWorkspaceSteps(): Effect.fn.Return<string, Error> {
    yield* prepareGitHubTagTarballWorkspace(GITHUB_SOURCE, workspacePath, version, runner);
    yield* commandOutput(
      runner,
      bun2nixPath,
      ["-o", `${workspacePath}/generatedPackage.nix`],
      workspacePath,
    );

    return yield* commandOutput(runner, "cat", [`${workspacePath}/generatedPackage.nix`]);
  });
}

function generatedBunNix(version: string, runner: CommandRunner): Effect.Effect<string, Error> {
  return Effect.flatMap(bun2nixOutPath(runner), (outPath: string): Effect.Effect<string, Error> => {
    const bun2nixPath = `${outPath.trim()}/bin/bun2nix`;

    return withTemporaryDirectory(
      (workspacePath: string): Effect.Effect<string, Error> =>
        generatedBunNixFromWorkspace(bun2nixPath, workspacePath, version, runner),
    );
  });
}

function writeUpdatedFiles(version: string, runner: CommandRunner): Effect.Effect<void, Error> {
  return Effect.gen(function* writeUpdatedFilesSteps(): Effect.fn.Return<void, Error> {
    const { bunNix, hash } = yield* Effect.all({
      bunNix: generatedBunNix(version, runner),
      hash: fetchGitHubSourceHash(GITHUB_SOURCE, version, REPOSITORY_ROOT_PATH, runner),
    });

    yield* writePinJson(PIN_FILE_PATH, {
      sourceHash: hash.trim(),
      version,
    });
    yield* writeTextFile(GENERATED_PACKAGE_FILE_PATH, `${bunNix.trim()}\n`);
    yield* formatNixFile(runner, GENERATED_PACKAGE_FILE_PATH);
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
    (version: string): Effect.Effect<void, Error> => writeUpdatedFiles(version, runner),
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
