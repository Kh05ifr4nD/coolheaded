import { commandOutput, readTextFile } from "coolheaded/core/updateScript.ts";
import type { CommandRunner } from "coolheaded/core/commandRunner.ts";
import { Effect } from "effect";
import { npmScopedTarballUrl } from "coolheaded/npm/registry.ts";
import { withTemporaryDirectory } from "coolheaded/core/temporaryDirectory.ts";

const NPM_PACKAGE_LOCK_FILE_NAME = "package-lock.json";

interface GeneratedNpmPackageLock {
  readonly npmVendorHash: string;
  readonly packageLock: string;
}

interface NpmPackageLockUpdate {
  readonly prepareWorkspace: (workspacePath: string) => Effect.Effect<void, Error>;
  readonly repositoryRootPath: string;
  readonly runner: CommandRunner;
}

interface NpmTarballWorkspace {
  readonly packageName: string;
  readonly runner: CommandRunner;
  readonly tarballBaseName: string;
  readonly version: string;
  readonly workspacePath: string;
}

function prefetchNpmDepsOutPath(
  repositoryRootPath: string,
  runner: CommandRunner,
): Effect.Effect<string, Error> {
  return commandOutput(runner, "nix", [
    "build",
    "--no-link",
    "--print-out-paths",
    "--inputs-from",
    repositoryRootPath,
    "nixpkgs#prefetch-npm-deps",
  ]);
}

function npmPackageLockPath(workspacePath: string): string {
  return `${workspacePath}/${NPM_PACKAGE_LOCK_FILE_NAME}`;
}

function prepareNpmTarballWorkspace(options: NpmTarballWorkspace): Effect.Effect<void, Error> {
  const archivePath = `${options.workspacePath}/package.tgz`;

  return Effect.zipRight(
    commandOutput(options.runner, "curl", [
      "-fsSL",
      npmScopedTarballUrl(options.packageName, options.tarballBaseName, options.version),
      "-o",
      archivePath,
    ]),
    Effect.asVoid(
      commandOutput(
        options.runner,
        "tar",
        ["-xzf", archivePath, "--strip-components=1"],
        options.workspacePath,
      ),
    ),
  );
}

function generatedNpmPackageLockFromWorkspace(
  prefetchNpmDepsPath: string,
  workspacePath: string,
  prepareWorkspace: (workspacePath: string) => Effect.Effect<void, Error>,
  runner: CommandRunner,
): Effect.Effect<GeneratedNpmPackageLock, Error> {
  return Effect.gen(function* generatedNpmPackageLockFromWorkspaceSteps(): Effect.fn.Return<
    GeneratedNpmPackageLock,
    Error
  > {
    const packageLockPath = npmPackageLockPath(workspacePath);

    yield* prepareWorkspace(workspacePath);

    const [packageLock, npmVendorHash] = yield* Effect.all([
      readTextFile(packageLockPath),
      commandOutput(runner, prefetchNpmDepsPath, [packageLockPath]),
    ]);

    return {
      npmVendorHash: npmVendorHash.trim(),
      packageLock: `${packageLock.trim()}\n`,
    };
  });
}

function generatedNpmPackageLock(
  options: NpmPackageLockUpdate,
): Effect.Effect<GeneratedNpmPackageLock, Error> {
  return Effect.flatMap(
    prefetchNpmDepsOutPath(options.repositoryRootPath, options.runner),
    (outPath: string): Effect.Effect<GeneratedNpmPackageLock, Error> => {
      const prefetchNpmDepsPath = `${outPath.trim()}/bin/prefetch-npm-deps`;

      return withTemporaryDirectory(
        (workspacePath: string): Effect.Effect<GeneratedNpmPackageLock, Error> =>
          generatedNpmPackageLockFromWorkspace(
            prefetchNpmDepsPath,
            workspacePath,
            options.prepareWorkspace,
            options.runner,
          ),
      );
    },
  );
}

export { generatedNpmPackageLock, NPM_PACKAGE_LOCK_FILE_NAME, prepareNpmTarballWorkspace };
export type { GeneratedNpmPackageLock, NpmPackageLockUpdate, NpmTarballWorkspace };
