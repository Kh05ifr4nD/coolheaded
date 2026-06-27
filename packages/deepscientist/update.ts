import {
  commandOutput,
  runUpdateScript,
  scriptPath,
  updateNewerPinVersion,
  writeTextFile,
} from "coolheaded/updateScript.ts";
import { Effect } from "effect";
import type { PackageHashConfig } from "coolheaded/packageConfigTypes.ts";
import { fetchFromGitHubHash } from "coolheaded/sourceHash.ts";
import { latestNpmVersion } from "coolheaded/latestVersion.ts";
import { npmPackageHashConfig } from "coolheaded/npmPackageUpdater.ts";
import { withTemporaryDirectory } from "coolheaded/temporaryDirectory.ts";

const NPM_PACKAGE_NAME = "@researai/deepscientist";
const PIN_FILE_PATH = scriptPath("pin.json", import.meta.url);
const REPOSITORY_ROOT_PATH = scriptPath("../../", import.meta.url);
const UV_LOCK_FILE_PATH = scriptPath("uv.lock", import.meta.url);
interface DeepScientistPin extends PackageHashConfig {
  readonly npmDepsHash: string;
  readonly sourceHash: string;
}

function latestVersion(): Effect.Effect<string, Error> {
  return latestNpmVersion(NPM_PACKAGE_NAME);
}

function sourceUrl(version: string): string {
  return `https://github.com/ResearAI/DeepScientist/archive/refs/tags/v${version}.tar.gz`;
}

function prefetchNpmDepsOutPath(): Effect.Effect<string, Error> {
  return commandOutput("nix", [
    "build",
    "--no-link",
    "--print-out-paths",
    "--inputs-from",
    REPOSITORY_ROOT_PATH,
    "nixpkgs#prefetch-npm-deps",
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

function prepareSourceWorkspace(
  workspacePath: string,
  version: string,
): Effect.Effect<void, Error> {
  return Effect.gen(function* prepareSourceWorkspaceSteps(): Effect.fn.Return<void, Error> {
    yield* downloadSourceArchive(workspacePath, version);
    yield* extractSourceArchive(workspacePath);
  });
}

function removeRuntimeOnlyPackageDependencies(workspacePath: string): Effect.Effect<string, Error> {
  return commandOutput("sh", [
    "-c",
    `jq '
      .dependencies |= del(
        .["@anthropic-ai/claude-code"],
        .["@openai/codex"],
        .["opencode-ai"]
      )
    ' "$1" > "$1.tmp" && mv "$1.tmp" "$1"`,
    "sh",
    `${workspacePath}/package.json`,
  ]);
}

function removeRuntimeOnlyPackageLockDependencies(
  workspacePath: string,
): Effect.Effect<string, Error> {
  return commandOutput("sh", [
    "-c",
    `jq '
      .packages[""].dependencies |= del(
        .["@anthropic-ai/claude-code"],
        .["@openai/codex"],
        .["opencode-ai"]
      )
      | .packages |= with_entries(
          select(
            (.key | test("^node_modules/@anthropic-ai/claude-code$")) | not
          )
          | select(
            (.key | test("^node_modules/@openai/codex(-.*)?$")) | not
          )
          | select(
            (.key | test("^node_modules/(opencode-ai|opencode-.+)$")) | not
          )
        )
    ' "$1" > "$1.tmp" && mv "$1.tmp" "$1"`,
    "sh",
    `${workspacePath}/package-lock.json`,
  ]);
}

function npmDepsHashFromWorkspace(
  prefetchNpmDepsPath: string,
  workspacePath: string,
  version: string,
): Effect.Effect<string, Error> {
  return Effect.gen(function* npmDepsHashFromWorkspaceSteps(): Effect.fn.Return<string, Error> {
    yield* prepareSourceWorkspace(workspacePath, version);
    yield* removeRuntimeOnlyPackageDependencies(workspacePath);
    yield* removeRuntimeOnlyPackageLockDependencies(workspacePath);

    return yield* commandOutput(prefetchNpmDepsPath, [`${workspacePath}/package-lock.json`]);
  });
}

function npmDepsHash(version: string): Effect.Effect<string, Error> {
  return Effect.flatMap(
    prefetchNpmDepsOutPath(),
    (outPath: string): Effect.Effect<string, Error> => {
      const prefetchNpmDepsPath = `${outPath.trim()}/bin/prefetch-npm-deps`;

      return withTemporaryDirectory(
        (workspacePath: string): Effect.Effect<string, Error> =>
          npmDepsHashFromWorkspace(prefetchNpmDepsPath, workspacePath, version),
      );
    },
  );
}

function generatedUvLockFromWorkspace(
  workspacePath: string,
  version: string,
): Effect.Effect<string, Error> {
  return Effect.gen(function* generatedUvLockFromWorkspaceSteps(): Effect.fn.Return<string, Error> {
    yield* prepareSourceWorkspace(workspacePath, version);
    yield* commandOutput(
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
    );

    return yield* commandOutput("cat", [`${workspacePath}/uv.lock`]);
  });
}

function generatedUvLock(version: string): Effect.Effect<string, Error> {
  return withTemporaryDirectory(
    (workspacePath: string): Effect.Effect<string, Error> =>
      generatedUvLockFromWorkspace(workspacePath, version),
  );
}

function serializePin(pin: DeepScientistPin): string {
  return `${JSON.stringify(
    pin,
    [
      "version",
      "hashes",
      "aarch64-darwin",
      "aarch64-linux",
      "x86_64-linux",
      "sourceHash",
      "npmDepsHash",
    ],
    2,
  )}\n`;
}

function writeUpdatedFiles(version: string): Effect.Effect<void, Error> {
  return Effect.gen(function* writeUpdatedFilesSteps(): Effect.fn.Return<void, Error> {
    const { packageConfig, sourceHash, uvLock } = yield* Effect.all({
      packageConfig: npmPackageHashConfig(NPM_PACKAGE_NAME, version),
      sourceHash: fetchFromGitHubHash(
        {
          owner: "ResearAI",
          repo: "DeepScientist",
          tag: `v${version}`,
        },
        REPOSITORY_ROOT_PATH,
      ),
      uvLock: generatedUvLock(version),
    });
    const npmDepsHashValue = yield* npmDepsHash(version);
    const pin = serializePin({
      ...packageConfig,
      npmDepsHash: npmDepsHashValue.trim(),
      sourceHash: sourceHash.trim(),
    });

    yield* writeTextFile(PIN_FILE_PATH, pin);
    yield* writeTextFile(UV_LOCK_FILE_PATH, `${uvLock.trim()}\n`);
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
