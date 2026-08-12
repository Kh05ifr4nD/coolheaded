import { runUpdateScript, scriptPath } from "coolheaded/core/updateScript.ts";
import { fetchJsonClient } from "coolheaded/core/fetchHttpClient.ts";
import { latestPyPiVersion } from "coolheaded/source/version.ts";
import { updateVersionedNixpkgsPythonUvLock } from "coolheaded/update/uvLock.ts";

const PYPI_PACKAGE_NAME = "strictdoc";
const PIN_FILE_PATH = scriptPath("pin.json", import.meta.url);
const PYTHON_PACKAGE = "python313";
const REPOSITORY_ROOT_PATH = scriptPath("../../", import.meta.url);
const UV_LOCK_FILE_PATH = scriptPath("uv.lock", import.meta.url);

runUpdateScript(import.meta.url, (args, runner) =>
  updateVersionedNixpkgsPythonUvLock({
    args,
    latestVersion: () => latestPyPiVersion(PYPI_PACKAGE_NAME, fetchJsonClient),
    pinFilePath: PIN_FILE_PATH,
    project: (version, pythonMinorVersion) => ({
      dependencies: [`strictdoc==${version}`],
      extraBuildDependencies: {
        strictdoc: ["hatchling"],
      },
      pythonMinorVersion,
    }),
    pythonPackage: PYTHON_PACKAGE,
    repositoryRootPath: REPOSITORY_ROOT_PATH,
    runner,
    uvLockFilePath: UV_LOCK_FILE_PATH,
  }),
);
