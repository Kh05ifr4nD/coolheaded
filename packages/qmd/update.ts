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
import { sanitizePackageJson } from "coolheaded/npm/tarball.ts";
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

interface UpdateDependencies {
  readonly generatedPackageFilePath: string;
  readonly jsonClient: JsonClient;
  readonly pinFilePath: string;
  readonly repositoryRootPath: string;
  readonly runner: CommandRunner;
}

function latestVersion(jsonClient: JsonClient): ReturnType<typeof latestGitHubVersion> {
  return latestGitHubVersion({ owner: GITHUB_SOURCE.owner, repo: GITHUB_SOURCE.repo }, jsonClient);
}

const BUN_NIX_HELPERS = ["copyPathToStore", "fetchFromGitHub", "fetchgit", "fetchurl"] as const;

function normalizeGeneratedBunNix(contents: string): string {
  const headerMatch = /^\{\n(?: {2}[^,\n]+,\n)+ {2}\.\.\.\n\}:/u.exec(contents);
  if (headerMatch === null) {
    return contents;
  }

  const body = contents.slice(headerMatch[0].length);
  const usedHelpers = BUN_NIX_HELPERS.filter((helper: string): boolean =>
    new RegExp(`\\b${helper}\\b`, "u").test(body),
  );
  const normalizedHeader = `{
${usedHelpers.map((helper: string): string => `  ${helper},\n`).join("")}  ...
}:`;

  return `${normalizedHeader}${body}`;
}

function bun2nixOutPath(dependencies: Readonly<UpdateDependencies>): Effect.Effect<string, Error> {
  return commandOutput(dependencies.runner, "nix", [
    "build",
    "--no-link",
    "--print-out-paths",
    "--inputs-from",
    dependencies.repositoryRootPath,
    "bun2nix#bun2nix",
  ]);
}

function generatedBunNixFromWorkspace(
  bun2nixPath: string,
  workspacePath: string,
  version: string,
  dependencies: Readonly<UpdateDependencies>,
): Effect.Effect<string, Error> {
  return Effect.gen(function* generatedBunNixFromWorkspaceSteps(): Effect.fn.Return<string, Error> {
    yield* prepareGitHubTagTarballWorkspace(
      GITHUB_SOURCE,
      workspacePath,
      version,
      dependencies.runner,
    );
    yield* sanitizePackageJson(`${workspacePath}/package.json`);
    yield* Effect.asVoid(
      commandOutput(
        dependencies.runner,
        "nix",
        [
          "run",
          "--inputs-from",
          dependencies.repositoryRootPath,
          "nixpkgs#bun",
          "--",
          "install",
          "--lockfile-only",
          "--ignore-scripts",
        ],
        workspacePath,
      ),
    );
    yield* commandOutput(
      dependencies.runner,
      bun2nixPath,
      ["-o", `${workspacePath}/generatedPackage.nix`],
      workspacePath,
    );

    const generatedPackageNix = yield* commandOutput(dependencies.runner, "cat", [
      `${workspacePath}/generatedPackage.nix`,
    ]);
    return normalizeGeneratedBunNix(generatedPackageNix);
  });
}

function generatedBunNix(
  version: string,
  dependencies: Readonly<UpdateDependencies>,
): Effect.Effect<string, Error> {
  return Effect.flatMap(
    bun2nixOutPath(dependencies),
    (outPath: string): Effect.Effect<string, Error> => {
      const bun2nixPath = `${outPath.trim()}/bin/bun2nix`;

      return withTemporaryDirectory((workspacePath: string): Effect.Effect<string, Error> =>
        generatedBunNixFromWorkspace(bun2nixPath, workspacePath, version, dependencies),
      );
    },
  );
}

function writeUpdatedFiles(
  version: string,
  dependencies: Readonly<UpdateDependencies>,
): Effect.Effect<void, Error> {
  return Effect.gen(function* writeUpdatedFilesSteps(): Effect.fn.Return<void, Error> {
    const { bunNix, hash } = yield* Effect.all({
      bunNix: generatedBunNix(version, dependencies),
      hash: fetchGitHubSourceHash(
        GITHUB_SOURCE,
        version,
        dependencies.repositoryRootPath,
        dependencies.runner,
      ),
    });

    yield* writePinJson(dependencies.pinFilePath, {
      sourceHash: hash.trim(),
      version,
    });
    yield* writeTextFile(dependencies.generatedPackageFilePath, `${bunNix.trim()}\n`);
    yield* formatNixFile(dependencies.runner, dependencies.generatedPackageFilePath);
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
    (version: string): Effect.Effect<void, Error> => writeUpdatedFiles(version, dependencies),
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
    generatedPackageFilePath: GENERATED_PACKAGE_FILE_PATH,
    jsonClient: fetchJsonClient,
    pinFilePath: PIN_FILE_PATH,
    repositoryRootPath: REPOSITORY_ROOT_PATH,
    runner,
  });
}

runUpdateScript(import.meta.url, cliProgram);

export { main, updateProgram };
export type { UpdateDependencies };
