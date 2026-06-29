import { runUpdateScript, scriptPath } from "coolheaded/updateScript.ts";
import { Effect } from "effect";
import { latestPyPiVersion } from "coolheaded/latestVersion.ts";
import { updateVersionedNixpkgsPythonUvLock } from "coolheaded/uvLockUpdater.ts";

const PYPI_PACKAGE_NAME = "mineru";
const PIN_FILE_PATH = scriptPath("pin.json", import.meta.url);
const PYTHON_PACKAGE = "python3";
const REPOSITORY_ROOT_PATH = scriptPath("../../", import.meta.url);
const UV_LOCK_FILE_PATH = scriptPath("uv.lock", import.meta.url);
type UvProject = ReturnType<Parameters<typeof updateVersionedNixpkgsPythonUvLock>[0]["project"]>;

function latestVersion(): Effect.Effect<string, Error> {
  return latestPyPiVersion(PYPI_PACKAGE_NAME);
}

function project(version: string, pythonMinorVersion: string): UvProject {
  return {
    dependencies: [`mineru[all]==${version}`],
    extraBuildDependencies: {
      pylatexenc: ["setuptools"],
      xgrammar: ["scikit_build_core"],
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
