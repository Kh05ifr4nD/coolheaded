import { runUpdateScript, scriptPath } from "coolheaded/updateScript.ts";
import { Effect } from "effect";
import { latestPyPiVersion } from "coolheaded/latestVersion.ts";
import { updateVersionedUvLock } from "coolheaded/uvLockUpdater.ts";

const PYPI_PACKAGE_NAME = "mineru";
const PIN_FILE_PATH = scriptPath("pin.json", import.meta.url);
const REPOSITORY_ROOT_PATH = scriptPath("../../", import.meta.url);
const UV_LOCK_FILE_PATH = scriptPath("uv.lock", import.meta.url);
function latestVersion(): Effect.Effect<string, Error> {
  return latestPyPiVersion(PYPI_PACKAGE_NAME);
}

function pyprojectContents(version: string): string {
  return `[project]
name = "mineruProject"
version = "${version}"
requires-python = ">=3.13,<3.14"
dependencies = ["mineru[all]==${version}"]

[tool.uv.extra-build-dependencies]
pylatexenc = ["setuptools"]
xgrammar = ["scikit_build_core"]
`;
}

function updateProgram(args: readonly string[]): Effect.Effect<void, Error> {
  return updateVersionedUvLock({
    args,
    latestVersion,
    pinFilePath: PIN_FILE_PATH,
    pyprojectContents,
    repositoryRootPath: REPOSITORY_ROOT_PATH,
    uvLockFilePath: UV_LOCK_FILE_PATH,
  });
}

async function main(args: readonly string[]): Promise<void> {
  await Effect.runPromise(updateProgram(args));
}

runUpdateScript(import.meta.url, updateProgram);

export { main };
