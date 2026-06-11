import {
  commandOutput,
  runUpdateScript,
  scriptPath,
  updateNewerPinVersion,
  writeTextFile,
} from "coolheaded/updateScript.ts";
import { Effect } from "effect";
import { latestGitHubVersion } from "coolheaded/latestVersion.ts";

const PIN_FILE_PATH = scriptPath("pin.json", import.meta.url);
const REPOSITORY_ROOT_PATH = scriptPath("../../", import.meta.url);
const UV_LOCK_FILE_PATH = scriptPath("uv.lock", import.meta.url);

function latestVersion(): Effect.Effect<string, Error> {
  return latestGitHubVersion({
    owner: "github",
    repo: "spec-kit",
    source: "releases",
  });
}

function serializePin(version: string): string {
  return `${JSON.stringify({ version }, null, 2)}\n`;
}

function pyprojectContents(version: string): string {
  return `[project]
name = "specKitProject"
version = "${version}"
requires-python = ">=3.13,<3.14"
dependencies = ["specify-cli @ git+https://github.com/github/spec-kit.git@v${version}"]

[tool.uv.extra-build-dependencies]
specify-cli = ["hatchling"]
`;
}

function temporaryDirectory(): Effect.Effect<string, Error> {
  return commandOutput("mktemp", ["-d"]);
}

function removeDirectory(path: string): Effect.Effect<void, Error> {
  return Effect.asVoid(commandOutput("rm", ["-rf", path]));
}

function generatedUvLock(version: string): Effect.Effect<string, Error> {
  return Effect.flatMap(
    temporaryDirectory(),
    (workspacePath: string): Effect.Effect<string, Error> =>
      Effect.ensuring(
        Effect.zipRight(
          writeTextFile(`${workspacePath}/pyproject.toml`, pyprojectContents(version)),
          Effect.zipRight(
            commandOutput(
              "nix",
              [
                "run",
                "--inputs-from",
                REPOSITORY_ROOT_PATH,
                "nixpkgs#uv",
                "--",
                "lock",
                "--project",
                workspacePath,
                "--no-progress",
              ],
              REPOSITORY_ROOT_PATH,
            ),
            commandOutput("cat", [`${workspacePath}/uv.lock`]),
          ),
        ),
        Effect.catchAll(removeDirectory(workspacePath), () => Effect.void),
      ),
  );
}

function updateProgram(args: readonly string[]): Effect.Effect<void, Error> {
  return updateNewerPinVersion(
    args,
    latestVersion,
    PIN_FILE_PATH,
    (version: string): Effect.Effect<void, Error> =>
      Effect.flatMap(
        generatedUvLock(version),
        (uvLock: string): Effect.Effect<void> =>
          Effect.zipRight(
            writeTextFile(PIN_FILE_PATH, serializePin(version)),
            writeTextFile(UV_LOCK_FILE_PATH, `${uvLock}\n`),
          ),
      ),
  );
}

async function main(args: readonly string[]): Promise<void> {
  await Effect.runPromise(updateProgram(args));
}

runUpdateScript(import.meta.url, updateProgram);

export { main };
