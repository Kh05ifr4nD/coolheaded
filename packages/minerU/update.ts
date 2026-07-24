import { runUpdateScript, scriptPath } from "coolheaded/core/updateScript.ts";
import type { CommandRunner } from "coolheaded/core/commandRunner.ts";
import { Effect } from "effect";
import { latestPyPiVersion } from "coolheaded/source/version.ts";
import { updateVersionedNixpkgsPythonUvLock } from "coolheaded/update/uvLock.ts";

const PYPI_PACKAGE_NAME = "mineru";
const PIN_FILE_PATH = scriptPath("pin.json", import.meta.url);
const PYTHON_PACKAGE = "python313";
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

function updateProgram(args: readonly string[], runner: CommandRunner): Effect.Effect<void, Error> {
  return updateVersionedNixpkgsPythonUvLock({
    args,
    latestVersion,
    pinFilePath: PIN_FILE_PATH,
    project,
    pythonPackage: PYTHON_PACKAGE,
    repositoryRootPath: REPOSITORY_ROOT_PATH,
    runner,
    uvLockFilePath: UV_LOCK_FILE_PATH,
  });
}

async function main(args: readonly string[], runner: CommandRunner): Promise<void> {
  await Effect.runPromise(updateProgram(args, runner));
}

runUpdateScript(import.meta.url, updateProgram);

export { main };
