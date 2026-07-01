import {
  commandOutput,
  runUpdateScript,
  scriptPath,
  updateNewerPinVersion,
  writeTextFile,
} from "coolheaded/updateScript.ts";
import { generatedNpmPackageLock, prepareNpmTarballWorkspace } from "coolheaded/npmLockUpdater.ts";
import { Effect } from "effect";
import { latestNpmVersion } from "coolheaded/latestVersion.ts";
import { npmPackageHashConfig } from "coolheaded/npmPackageUpdater.ts";
import { writePinJson } from "coolheaded/pinJson.ts";

const NPM_PACKAGE_NAME = "skills";
const PACKAGE_LOCK_FILE_PATH = scriptPath("package-lock.json", import.meta.url);
const PIN_FILE_PATH = scriptPath("pin.json", import.meta.url);
const REPOSITORY_ROOT_PATH = scriptPath("../../", import.meta.url);

function latestVersion(): Effect.Effect<string, Error> {
  return latestNpmVersion(NPM_PACKAGE_NAME);
}

function preparePackageLockWorkspace(
  workspacePath: string,
  version: string,
): Effect.Effect<void, Error> {
  return Effect.gen(function* preparePackageLockWorkspaceSteps(): Effect.fn.Return<void, Error> {
    yield* prepareNpmTarballWorkspace({
      packageName: NPM_PACKAGE_NAME,
      tarballBaseName: NPM_PACKAGE_NAME,
      version,
      workspacePath,
    });
    yield* commandOutput("sh", [
      "-c",
      `jq 'del(.devDependencies, .scripts)' "$1" > "$1.tmp" && mv "$1.tmp" "$1"`,
      "sh",
      `${workspacePath}/package.json`,
    ]);
    yield* commandOutput(
      "nix",
      [
        "shell",
        "--inputs-from",
        REPOSITORY_ROOT_PATH,
        "nixpkgs#nodejs",
        "-c",
        "npm",
        "install",
        "--package-lock-only",
        "--ignore-scripts",
        "--omit=dev",
        "--no-audit",
        "--no-fund",
        "--silent",
      ],
      workspacePath,
    );
  });
}

function updateProgram(args: readonly string[]): Effect.Effect<void, Error> {
  return updateNewerPinVersion(
    args,
    latestVersion,
    PIN_FILE_PATH,
    (version: string): Effect.Effect<void, Error> =>
      Effect.flatMap(
        Effect.all({
          npmLock: generatedNpmPackageLock({
            prepareWorkspace: (workspacePath: string): Effect.Effect<void, Error> =>
              preparePackageLockWorkspace(workspacePath, version),
            repositoryRootPath: REPOSITORY_ROOT_PATH,
          }),
          packageConfig: npmPackageHashConfig(NPM_PACKAGE_NAME, version),
        }),
        ({ npmLock, packageConfig }): Effect.Effect<void, Error> =>
          Effect.zipRight(
            writePinJson(PIN_FILE_PATH, {
              ...packageConfig,
              npmVendorHash: npmLock.npmVendorHash,
            }),
            writeTextFile(PACKAGE_LOCK_FILE_PATH, npmLock.packageLock),
          ),
      ),
  );
}

async function main(args: readonly string[]): Promise<void> {
  await Effect.runPromise(updateProgram(args));
}

runUpdateScript(import.meta.url, updateProgram);

export { main };
