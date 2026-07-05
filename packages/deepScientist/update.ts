import {
  commandOutput,
  runUpdateScript,
  scriptPath,
  updateNewerPinVersion,
  writeTextFile,
} from "coolheaded/core/updateScript.ts";
import {
  fetchGitHubSourceHash,
  prepareGitHubTagTarballWorkspace,
} from "coolheaded/source/github.ts";
import { Effect } from "effect";
import { generatedNpmPackageLock } from "coolheaded/npm/lock.ts";
import { latestNpmVersion } from "coolheaded/source/version.ts";
import { npmPackageHashConfig } from "coolheaded/npm/packageHash.ts";
import { writePinJson } from "coolheaded/pin/json.ts";

const NPM_PACKAGE_NAME = "@researai/deepscientist";
const PACKAGE_LOCK_FILE_PATH = scriptPath("package-lock.json", import.meta.url);
const PIN_FILE_PATH = scriptPath("pin.json", import.meta.url);
const REPOSITORY_ROOT_PATH = scriptPath("../../", import.meta.url);
const GITHUB_SOURCE = {
  owner: "ResearAI",
  repo: "DeepScientist",
  tag: (version: string): string => `v${version}`,
};

interface RuntimeOnlyNpmDependency {
  readonly packageLockEntryPrefixes?: readonly string[];
  readonly packageName: string;
}

const RUNTIME_ONLY_NPM_DEPENDENCIES: readonly RuntimeOnlyNpmDependency[] = [
  { packageName: "@anthropic-ai/claude-code" },
  {
    packageLockEntryPrefixes: ["node_modules/@openai/codex-"],
    packageName: "@openai/codex",
  },
  {
    packageLockEntryPrefixes: ["node_modules/opencode-"],
    packageName: "opencode-ai",
  },
];

function latestVersion(): Effect.Effect<string, Error> {
  return latestNpmVersion(NPM_PACKAGE_NAME);
}

function prepareSourceWorkspace(
  workspacePath: string,
  version: string,
): Effect.Effect<void, Error> {
  return prepareGitHubTagTarballWorkspace(GITHUB_SOURCE, workspacePath, version);
}

function packageLockEntryPath(packageName: string): string {
  return `node_modules/${packageName}`;
}

function runtimeOnlyPackageNames(): readonly string[] {
  return RUNTIME_ONLY_NPM_DEPENDENCIES.map(
    (dependency: RuntimeOnlyNpmDependency): string => dependency.packageName,
  );
}

function runtimeOnlyPackageLockEntryPaths(): readonly string[] {
  return RUNTIME_ONLY_NPM_DEPENDENCIES.map((dependency: RuntimeOnlyNpmDependency): string =>
    packageLockEntryPath(dependency.packageName),
  );
}

function runtimeOnlyPackageLockEntryPrefixes(): readonly string[] {
  return RUNTIME_ONLY_NPM_DEPENDENCIES.flatMap(
    (dependency: RuntimeOnlyNpmDependency): readonly string[] =>
      dependency.packageLockEntryPrefixes ?? [],
  );
}

function jqJson(value: unknown): string {
  return JSON.stringify(value);
}

function removeRuntimeOnlyPackageDependencies(workspacePath: string): Effect.Effect<string, Error> {
  return commandOutput("sh", [
    "-c",
    `jq --argjson dependencyNames "$2" '
      .dependencies |= with_entries(
        .key as $dependencyName
        | select(($dependencyNames | index($dependencyName)) | not)
      )
    ' "$1" > "$1.tmp" && mv "$1.tmp" "$1"`,
    "sh",
    `${workspacePath}/package.json`,
    jqJson(runtimeOnlyPackageNames()),
  ]);
}

function removeRuntimeOnlyPackageLockDependencies(
  workspacePath: string,
): Effect.Effect<string, Error> {
  return commandOutput("sh", [
    "-c",
    `jq --argjson dependencyNames "$2" --argjson packageLockEntryPaths "$3" --argjson packageLockEntryPrefixes "$4" '
      .packages[""].dependencies |= with_entries(
        .key as $dependencyName
        | select(($dependencyNames | index($dependencyName)) | not)
      )
      | .packages |= with_entries(
        .key as $packagePath
        | select(
          (
            ($packageLockEntryPaths | index($packagePath)) != null
            or any($packageLockEntryPrefixes[]; . as $prefix | $packagePath | startswith($prefix))
          ) | not
        )
      )
    ' "$1" > "$1.tmp" && mv "$1.tmp" "$1"`,
    "sh",
    `${workspacePath}/package-lock.json`,
    jqJson(runtimeOnlyPackageNames()),
    jqJson(runtimeOnlyPackageLockEntryPaths()),
    jqJson(runtimeOnlyPackageLockEntryPrefixes()),
  ]);
}

function prepareNpmPackageLockWorkspace(
  workspacePath: string,
  version: string,
): Effect.Effect<void, Error> {
  return Effect.gen(function* prepareNpmPackageLockWorkspaceSteps(): Effect.fn.Return<void, Error> {
    yield* prepareSourceWorkspace(workspacePath, version);
    yield* removeRuntimeOnlyPackageDependencies(workspacePath);
    yield* removeRuntimeOnlyPackageLockDependencies(workspacePath);
  });
}

function writeUpdatedFiles(version: string): Effect.Effect<void, Error> {
  return Effect.gen(function* writeUpdatedFilesSteps(): Effect.fn.Return<void, Error> {
    const { npmLock, packageConfig, sourceHash } = yield* Effect.all({
      npmLock: generatedNpmPackageLock({
        prepareWorkspace: (workspacePath: string): Effect.Effect<void, Error> =>
          prepareNpmPackageLockWorkspace(workspacePath, version),
        repositoryRootPath: REPOSITORY_ROOT_PATH,
      }),
      packageConfig: npmPackageHashConfig(NPM_PACKAGE_NAME, version),
      sourceHash: fetchGitHubSourceHash(GITHUB_SOURCE, version, REPOSITORY_ROOT_PATH),
    });

    yield* writePinJson(PIN_FILE_PATH, {
      ...packageConfig,
      npmVendorHash: npmLock.npmVendorHash,
      sourceHash: sourceHash.trim(),
    });
    yield* writeTextFile(PACKAGE_LOCK_FILE_PATH, npmLock.packageLock);
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
