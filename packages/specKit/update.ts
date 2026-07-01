import { runUpdateScript, scriptPath } from "coolheaded/core/updateScript.ts";
import { Effect } from "effect";
import { latestGitHubVersion } from "coolheaded/sources/latestVersion.ts";
import { updateVersionedNixpkgsPythonUvLock } from "coolheaded/updates/uvLock.ts";

const PIN_FILE_PATH = scriptPath("pin.json", import.meta.url);
const PYTHON_PACKAGE = "python3";
const REPOSITORY_ROOT_PATH = scriptPath("../../", import.meta.url);
const UV_LOCK_FILE_PATH = scriptPath("uv.lock", import.meta.url);
type UvProject = ReturnType<Parameters<typeof updateVersionedNixpkgsPythonUvLock>[0]["project"]>;

function latestVersion(): Effect.Effect<string, Error> {
  return latestGitHubVersion({
    owner: "github",
    repo: "spec-kit",
    source: "releases",
  });
}

function project(version: string, pythonMinorVersion: string): UvProject {
  return {
    dependencies: [`specify-cli @ git+https://github.com/github/spec-kit.git@v${version}`],
    extraBuildDependencies: {
      "specify-cli": ["hatchling"],
    },
    pythonMinorVersion,
  };
}

function updateProgram(args: readonly string[]): Effect.Effect<void, Error> {
  return updateVersionedNixpkgsPythonUvLock({
    args,
    latestVersion,
    pinFilePath: PIN_FILE_PATH,
    project,
    pythonPackage: PYTHON_PACKAGE,
    repositoryRootPath: REPOSITORY_ROOT_PATH,
    uvLockFilePath: UV_LOCK_FILE_PATH,
  });
}

async function main(args: readonly string[]): Promise<void> {
  await Effect.runPromise(updateProgram(args));
}

runUpdateScript(import.meta.url, updateProgram);

export { main };
