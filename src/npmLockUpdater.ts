import { commandOutput, readTextFile } from "./updateScript.ts";
import { Effect } from "effect";
import { npmScopedTarballUrl } from "./npmRegistry.ts";
import { withTemporaryDirectory } from "./temporaryDirectory.ts";

const NPM_PACKAGE_LOCK_FILE_NAME = "package-lock.json";

interface GeneratedNpmPackageLock {
  readonly npmVendorHash: string;
  readonly packageLock: string;
}

interface NpmPackageLockUpdate {
  readonly prepareWorkspace: (workspacePath: string) => Effect.Effect<void, Error>;
  readonly repositoryRootPath: string;
}

interface NpmTarballWorkspace {
  readonly packageName: string;
  readonly tarballBaseName: string;
  readonly version: string;
  readonly workspacePath: string;
}

function prefetchNpmDepsOutPath(repositoryRootPath: string): Effect.Effect<string, Error> {
  return commandOutput("nix", [
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
    commandOutput("curl", [
      "-fsSL",
      npmScopedTarballUrl(options.packageName, options.tarballBaseName, options.version),
      "-o",
      archivePath,
    ]),
    Effect.asVoid(
      commandOutput("tar", ["-xzf", archivePath, "--strip-components=1"], options.workspacePath),
    ),
  );
}

function generatedNpmPackageLockFromWorkspace(
  prefetchNpmDepsPath: string,
  workspacePath: string,
  prepareWorkspace: (workspacePath: string) => Effect.Effect<void, Error>,
): Effect.Effect<GeneratedNpmPackageLock, Error> {
  return Effect.gen(function* generatedNpmPackageLockFromWorkspaceSteps(): Effect.fn.Return<
    GeneratedNpmPackageLock,
    Error
  > {
    const packageLockPath = npmPackageLockPath(workspacePath);

    yield* prepareWorkspace(workspacePath);

    const [packageLock, npmVendorHash] = yield* Effect.all([
      readTextFile(packageLockPath),
      commandOutput(prefetchNpmDepsPath, [packageLockPath]),
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
    prefetchNpmDepsOutPath(options.repositoryRootPath),
    (outPath: string): Effect.Effect<GeneratedNpmPackageLock, Error> => {
      const prefetchNpmDepsPath = `${outPath.trim()}/bin/prefetch-npm-deps`;

      return withTemporaryDirectory(
        (workspacePath: string): Effect.Effect<GeneratedNpmPackageLock, Error> =>
          generatedNpmPackageLockFromWorkspace(
            prefetchNpmDepsPath,
            workspacePath,
            options.prepareWorkspace,
          ),
      );
    },
  );
}

export { generatedNpmPackageLock, NPM_PACKAGE_LOCK_FILE_NAME, prepareNpmTarballWorkspace };
export type { GeneratedNpmPackageLock, NpmPackageLockUpdate, NpmTarballWorkspace };
