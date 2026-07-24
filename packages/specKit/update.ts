import { runUpdateScript, scriptPath } from "coolheaded/core/updateScript.ts";
import type { CommandRunner } from "coolheaded/core/commandRunner.ts";
import { Effect } from "effect";
import type { JsonClient } from "coolheaded/core/httpClient.ts";
import { fetchJsonClient } from "coolheaded/core/fetchHttpClient.ts";
import { latestGitHubVersion } from "coolheaded/source/githubVersion.ts";
import { updateVersionedNixpkgsPythonUvLock } from "coolheaded/update/uvLock.ts";

const PIN_FILE_PATH = scriptPath("pin.json", import.meta.url);
const PYTHON_PACKAGE = "python313";
const REPOSITORY_ROOT_PATH = scriptPath("../../", import.meta.url);
const UV_LOCK_FILE_PATH = scriptPath("uv.lock", import.meta.url);
type UvProject = ReturnType<Parameters<typeof updateVersionedNixpkgsPythonUvLock>[0]["project"]>;

function latestVersion(jsonClient: JsonClient): ReturnType<typeof latestGitHubVersion> {
  return latestGitHubVersion({ owner: "github", repo: "spec-kit", source: "releases" }, jsonClient);
}

function project(version: string, pythonMinorVersion: string): UvProject {
  return {
    dependencies: [`specify-cli @ git+https://github.com/github/spec-kit.git@v${version}`],
    extraBuildDependencies: {
      "specify-cli": ["hatchling"],
    },
    name: "specKitProject",
    pythonMinorVersion,
    version,
  };
}

function updateProgram(
  args: readonly string[],
  runner: CommandRunner,
  jsonClient: JsonClient,
): Effect.Effect<void, Error> {
  return updateVersionedNixpkgsPythonUvLock({
    args,
    latestVersion: (): Effect.Effect<string, Error> => latestVersion(jsonClient),
    pinFilePath: PIN_FILE_PATH,
    project,
    pythonPackage: PYTHON_PACKAGE,
    repositoryRootPath: REPOSITORY_ROOT_PATH,
    runner,
    uvLockFilePath: UV_LOCK_FILE_PATH,
  });
}

async function main(
  args: readonly string[],
  runner: CommandRunner,
  jsonClient: JsonClient,
): Promise<void> {
  await Effect.runPromise(updateProgram(args, runner, jsonClient));
}

function cliProgram(args: readonly string[], runner: CommandRunner): Effect.Effect<void, Error> {
  return updateProgram(args, runner, fetchJsonClient);
}

runUpdateScript(import.meta.url, cliProgram);

export { main };
