import {
  commandOutput,
  formatNixFile,
  runUpdateScript,
  scriptPath,
  updateNewerPinVersion,
  writeTextFile,
} from "coolheaded/updateScript.ts";
import { Effect } from "effect";
import { fetchFromGitHubHash } from "coolheaded/sourceHash.ts";
import { latestGitHubVersion } from "coolheaded/latestVersion.ts";
import { withTemporaryDirectory } from "coolheaded/temporaryDirectory.ts";

const GENERATED_PACKAGE_FILE_PATH = scriptPath("generatedPackage.nix", import.meta.url);
const PIN_FILE_PATH = scriptPath("pin.json", import.meta.url);
const REPOSITORY_ROOT_PATH = scriptPath("../../", import.meta.url);
function latestVersion(): Effect.Effect<string, Error> {
  return latestGitHubVersion({
    owner: "tobi",
    repo: "qmd",
  });
}

interface QmdPin {
  readonly hash: string;
  readonly version: string;
}

function sourceUrl(version: string): string {
  return `https://github.com/tobi/qmd/archive/refs/tags/v${version}.tar.gz`;
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

function downloadSourceArchive(
  workspacePath: string,
  version: string,
): Effect.Effect<string, Error> {
  return commandOutput("curl", ["-fsSL", sourceUrl(version), "-o", `${workspacePath}/source.tgz`]);
}

function extractSourceArchive(workspacePath: string): Effect.Effect<string, Error> {
  return commandOutput(
    "tar",
    ["-xzf", `${workspacePath}/source.tgz`, "--strip-components=1"],
    workspacePath,
  );
}

function generatedBunNixFromWorkspace(
  bun2nixPath: string,
  workspacePath: string,
  version: string,
): Effect.Effect<string, Error> {
  return Effect.gen(function* generatedBunNixFromWorkspaceSteps(): Effect.fn.Return<string, Error> {
    yield* downloadSourceArchive(workspacePath, version);
    yield* extractSourceArchive(workspacePath);
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

function serializePin(pin: QmdPin): string {
  return `${JSON.stringify(pin, ["version", "hash"], 2)}\n`;
}

function writeUpdatedFiles(version: string): Effect.Effect<void, Error> {
  return Effect.gen(function* writeUpdatedFilesSteps(): Effect.fn.Return<void, Error> {
    const { bunNix, hash } = yield* Effect.all({
      bunNix: generatedBunNix(version),
      hash: fetchFromGitHubHash(
        {
          owner: "tobi",
          repo: "qmd",
          tag: `v${version}`,
        },
        REPOSITORY_ROOT_PATH,
      ),
    });
    const pin = serializePin({
      hash: hash.trim(),
      version,
    });

    yield* writeTextFile(PIN_FILE_PATH, pin);
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
