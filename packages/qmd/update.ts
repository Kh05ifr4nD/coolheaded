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
import { Effect } from "effect";
import { latestGitHubVersion } from "coolheaded/source/version.ts";
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

function latestVersion(): Effect.Effect<string, Error> {
  return latestGitHubVersion({
    owner: GITHUB_SOURCE.owner,
    repo: GITHUB_SOURCE.repo,
  });
}

function bun2nixOutPath(): Effect.Effect<string, Error> {
  return commandOutput("nix", [
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
): Effect.Effect<string, Error> {
  return Effect.gen(function* generatedBunNixFromWorkspaceSteps(): Effect.fn.Return<string, Error> {
    yield* prepareGitHubTagTarballWorkspace(GITHUB_SOURCE, workspacePath, version);
    yield* commandOutput(
      bun2nixPath,
      ["-o", `${workspacePath}/generatedPackage.nix`],
      workspacePath,
    );

    return yield* commandOutput("cat", [`${workspacePath}/generatedPackage.nix`]);
  });
}

function generatedBunNix(version: string): Effect.Effect<string, Error> {
  return Effect.flatMap(bun2nixOutPath(), (outPath: string): Effect.Effect<string, Error> => {
    const bun2nixPath = `${outPath.trim()}/bin/bun2nix`;

    return withTemporaryDirectory(
      (workspacePath: string): Effect.Effect<string, Error> =>
        generatedBunNixFromWorkspace(bun2nixPath, workspacePath, version),
    );
  });
}

function writeUpdatedFiles(version: string): Effect.Effect<void, Error> {
  return Effect.gen(function* writeUpdatedFilesSteps(): Effect.fn.Return<void, Error> {
    const { bunNix, hash } = yield* Effect.all({
      bunNix: generatedBunNix(version),
      hash: fetchGitHubSourceHash(GITHUB_SOURCE, version, REPOSITORY_ROOT_PATH),
    });

    yield* writePinJson(PIN_FILE_PATH, {
      sourceHash: hash.trim(),
      version,
    });
    yield* writeTextFile(GENERATED_PACKAGE_FILE_PATH, `${bunNix.trim()}\n`);
    yield* formatNixFile(GENERATED_PACKAGE_FILE_PATH);
  });
}

function updateProgram(args: readonly string[]): Effect.Effect<void, Error> {
  return updateNewerPinVersion(args, latestVersion, PIN_FILE_PATH, writeUpdatedFiles);
}

async function main(args: readonly string[]): Promise<void> {
  await Effect.runPromise(updateProgram(args));
}

runUpdateScript(import.meta.url, updateProgram);

export { main };
