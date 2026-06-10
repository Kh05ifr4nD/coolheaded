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

function temporaryDirectory(): Effect.Effect<string, Error> {
  return commandOutput("mktemp", ["-d"]);
}

function removeDirectory(path: string): Effect.Effect<void, Error> {
  return Effect.asVoid(commandOutput("rm", ["-rf", path]));
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

function generatedBunNix(version: string): Effect.Effect<string, Error> {
  return Effect.flatMap(
    bun2nixOutPath(),
    (outPath: string): Effect.Effect<string, Error> =>
      Effect.flatMap(
        temporaryDirectory(),
        (workspacePath: string): Effect.Effect<string, Error> =>
          Effect.ensuring(
            Effect.zipRight(
              commandOutput("curl", [
                "-fsSL",
                sourceUrl(version),
                "-o",
                `${workspacePath}/source.tgz`,
              ]),
              Effect.zipRight(
                commandOutput(
                  "tar",
                  ["-xzf", `${workspacePath}/source.tgz`, "--strip-components=1"],
                  workspacePath,
                ),
                Effect.zipRight(
                  commandOutput(
                    `${outPath.trim()}/bin/bun2nix`,
                    ["-o", `${workspacePath}/generatedPackage.nix`],
                    workspacePath,
                  ),
                  commandOutput("cat", [`${workspacePath}/generatedPackage.nix`]),
                ),
              ),
            ),
            Effect.catchAll(removeDirectory(workspacePath), () => Effect.void),
          ),
      ),
  );
}

function serializePin(pin: QmdPin): string {
  return `${JSON.stringify(pin, ["version", "hash"], 2)}\n`;
}

function updateProgram(args: readonly string[]): Effect.Effect<void, Error> {
  return updateNewerPinVersion(
    args,
    latestVersion,
    PIN_FILE_PATH,
    (version: string): Effect.Effect<void, Error> =>
      Effect.flatMap(
        Effect.all({
          bunNix: generatedBunNix(version),
          hash: fetchFromGitHubHash(
            {
              owner: "tobi",
              repo: "qmd",
              tag: `v${version}`,
            },
            REPOSITORY_ROOT_PATH,
          ),
        }),
        ({ bunNix, hash }): Effect.Effect<void, Error> =>
          Effect.zipRight(
            writeTextFile(
              PIN_FILE_PATH,
              serializePin({
                hash: hash.trim(),
                version,
              }),
            ),
            Effect.zipRight(
              writeTextFile(GENERATED_PACKAGE_FILE_PATH, `${bunNix.trim()}\n`),
              formatNixFile(GENERATED_PACKAGE_FILE_PATH),
            ),
          ),
      ),
  );
}

async function main(args: readonly string[]): Promise<void> {
  await Effect.runPromise(updateProgram(args));
}

runUpdateScript(import.meta.url, updateProgram);

export { main };
