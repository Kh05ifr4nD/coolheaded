import {
  UpdateError,
  commandOutput,
  readTextFile,
  scriptPath,
  updateNewerPinVersion,
  writeTextFile,
} from "coolheaded/core/updateScript.ts";
import { generatedNpmPackageLock, prepareNpmTarballWorkspace } from "coolheaded/npm/lock.ts";
import type { CommandRunner } from "coolheaded/core/commandRunner.ts";
import { Effect } from "effect";
import type { JsonClient } from "coolheaded/core/httpClient.ts";
import { latestNpmVersion } from "coolheaded/source/version.ts";
import { npmPackageHashConfig } from "coolheaded/npm/packageHash.ts";
import { writePinJson } from "coolheaded/pin/json.ts";

interface NpmTarballPackageUpdate {
  readonly args: readonly string[];
  readonly importMetaUrl: string;
  readonly jsonClient: JsonClient;
  readonly packageName: string;
  readonly runner: CommandRunner;
  readonly tarballBaseName?: string;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parsedPackageJson(
  contents: string,
  packageJsonPath: string,
): Effect.Effect<unknown, Error> {
  try {
    const packageJson: unknown = JSON.parse(contents);
    return Effect.succeed(packageJson);
  } catch (error: unknown) {
    return Effect.fail(
      error instanceof Error ? error : new UpdateError(`Failed to parse ${packageJsonPath}`),
    );
  }
}

function runtimePackageJson(value: unknown, packageJsonPath: string): Effect.Effect<string, Error> {
  if (!isRecord(value)) {
    return Effect.fail(new UpdateError(`Invalid package JSON: ${packageJsonPath}`));
  }

  const packageJson: Record<string, unknown> = { ...value };
  delete packageJson["devDependencies"];
  delete packageJson["scripts"];

  return Effect.succeed(`${JSON.stringify(packageJson, null, 2)}\n`);
}

function sanitizePackageJson(packageJsonPath: string): Effect.Effect<void, Error> {
  return Effect.flatMap(
    readTextFile(packageJsonPath),
    (contents: string): Effect.Effect<void, Error> =>
      Effect.flatMap(
        parsedPackageJson(contents, packageJsonPath),
        (packageJson: unknown): Effect.Effect<void, Error> =>
          Effect.flatMap(
            runtimePackageJson(packageJson, packageJsonPath),
            (runtimeJson: string): Effect.Effect<void, Error> =>
              writeTextFile(packageJsonPath, runtimeJson),
          ),
      ),
  );
}

function npmInstallPackageLock(
  repositoryRootPath: string,
  workspacePath: string,
  runner: CommandRunner,
): Effect.Effect<void, Error> {
  return Effect.asVoid(
    commandOutput(
      runner,
      "nix",
      [
        "shell",
        "--inputs-from",
        repositoryRootPath,
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
    ),
  );
}

function prepareNpmPackageLockWorkspace(
  options: NpmTarballPackageUpdate,
  repositoryRootPath: string,
  workspacePath: string,
  version: string,
): Effect.Effect<void, Error> {
  return Effect.gen(function* prepareNpmPackageLockWorkspaceSteps(): Effect.fn.Return<void, Error> {
    yield* prepareNpmTarballWorkspace({
      packageName: options.packageName,
      runner: options.runner,
      tarballBaseName: options.tarballBaseName ?? options.packageName,
      version,
      workspacePath,
    });
    yield* sanitizePackageJson(`${workspacePath}/package.json`);
    yield* npmInstallPackageLock(repositoryRootPath, workspacePath, options.runner);
  });
}

function updateNpmTarballPackage(options: NpmTarballPackageUpdate): Effect.Effect<void, Error> {
  const packageLockFilePath = scriptPath("package-lock.json", options.importMetaUrl);
  const pinFilePath = scriptPath("pin.json", options.importMetaUrl);
  const repositoryRootPath = scriptPath("../../", options.importMetaUrl);

  return updateNewerPinVersion(
    options.args,
    (): Effect.Effect<string, Error> => latestNpmVersion(options.packageName, options.jsonClient),
    pinFilePath,
    (version: string): Effect.Effect<void, Error> =>
      Effect.flatMap(
        Effect.all({
          npmLock: generatedNpmPackageLock({
            prepareWorkspace: (workspacePath: string): Effect.Effect<void, Error> =>
              prepareNpmPackageLockWorkspace(options, repositoryRootPath, workspacePath, version),
            repositoryRootPath,
            runner: options.runner,
          }),
          packageConfig: npmPackageHashConfig(options.packageName, version, options.jsonClient),
        }),
        ({ npmLock, packageConfig }): Effect.Effect<void, Error> =>
          Effect.zipRight(
            writePinJson(pinFilePath, {
              ...packageConfig,
              npmVendorHash: npmLock.npmVendorHash,
            }),
            writeTextFile(packageLockFilePath, npmLock.packageLock),
          ),
      ),
  );
}

export { updateNpmTarballPackage };
export type { NpmTarballPackageUpdate };
