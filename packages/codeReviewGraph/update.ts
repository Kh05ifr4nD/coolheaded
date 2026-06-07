import {
  commandOutput,
  requestedOrLatestVersion,
  runUpdateScript,
  scriptPath,
  writeTextFile,
} from "coolheaded/updateScript.ts";
import { Effect } from "effect";
import { latestPyPiVersion } from "coolheaded/latestVersion.ts";

const PYPI_PACKAGE_NAME = "code-review-graph";
const PIN_FILE_PATH = scriptPath("pin.json", import.meta.url);
const REPOSITORY_ROOT_PATH = scriptPath("../../", import.meta.url);
const UV_LOCK_FILE_PATH = scriptPath("uv.lock", import.meta.url);
function latestVersion(): Effect.Effect<string, Error> {
  return latestPyPiVersion(PYPI_PACKAGE_NAME);
}

const LOCKED_DEPENDENCIES = [
  "all",
  "communities",
  "embeddings",
  "enrichment",
  "eval",
  "google-embeddings",
  "wiki",
] as const;

function serializePin(version: string): string {
  return `${JSON.stringify({ version }, null, 2)}\n`;
}

function pyprojectContents(version: string): string {
  const dependencies = LOCKED_DEPENDENCIES.map(
    (extra: string): string => `  "code-review-graph[${extra}]==${version}",`,
  ).join("\n");

  return `[project]
name = "codeReviewGraphProject"
version = "${version}"
requires-python = ">=3.14,<3.15"
dependencies = [
${dependencies}
]

[tool.uv.extra-build-dependencies]
watchdog = ["setuptools"]
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
          writeTextFile(
            `${workspacePath}/pyproject.toml`,
            pyprojectContents(version),
          ),
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
  return Effect.flatMap(
    requestedOrLatestVersion(args, latestVersion),
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
