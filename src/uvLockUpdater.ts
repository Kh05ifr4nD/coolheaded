import { commandOutput, updateNewerPinVersion, writeTextFile } from "./updateScript.ts";
import { Effect } from "effect";
import { withTemporaryDirectory } from "./temporaryDirectory.ts";

interface VersionedUvLockUpdate {
  readonly args: readonly string[];
  readonly latestVersion: () => Effect.Effect<string, Error>;
  readonly pinFilePath: string;
  readonly pyprojectContents: (version: string) => string;
  readonly repositoryRootPath: string;
  readonly uvLockFilePath: string;
}

function serializeVersionPin(version: string): string {
  return `${JSON.stringify({ version }, null, 2)}\n`;
}

function generatedUvLock(
  repositoryRootPath: string,
  pyprojectContents: string,
): Effect.Effect<string, Error> {
  return withTemporaryDirectory(
    (workspacePath: string): Effect.Effect<string, Error> =>
      Effect.zipRight(
        writeTextFile(`${workspacePath}/pyproject.toml`, pyprojectContents),
        Effect.zipRight(
          commandOutput(
            "nix",
            [
              "run",
              "--inputs-from",
              repositoryRootPath,
              "nixpkgs#uv",
              "--",
              "lock",
              "--project",
              workspacePath,
              "--no-progress",
            ],
            repositoryRootPath,
          ),
          commandOutput("cat", [`${workspacePath}/uv.lock`]),
        ),
      ),
  );
}

function updateVersionedUvLock(options: VersionedUvLockUpdate): Effect.Effect<void, Error> {
  return updateNewerPinVersion(
    options.args,
    options.latestVersion,
    options.pinFilePath,
    (version: string): Effect.Effect<void, Error> =>
      Effect.flatMap(
        generatedUvLock(options.repositoryRootPath, options.pyprojectContents(version)),
        (uvLock: string): Effect.Effect<void> =>
          Effect.zipRight(
            writeTextFile(options.pinFilePath, serializeVersionPin(version)),
            writeTextFile(options.uvLockFilePath, `${uvLock.trim()}\n`),
          ),
      ),
  );
}

export { generatedUvLock, updateVersionedUvLock };
export type { VersionedUvLockUpdate };
