import { runUpdateScript, scriptPath } from "coolheaded/core/updateScript.ts";
import { fetchJsonClient } from "coolheaded/core/fetchHttpClient.ts";
import { latestGitHubVersion } from "coolheaded/source/githubVersion.ts";
import { updateVersionedNixpkgsPythonUvLock } from "coolheaded/update/uvLock.ts";

const PIN_FILE_PATH = scriptPath("pin.json", import.meta.url);
const PYTHON_PACKAGE = "python3";
const REPOSITORY_ROOT_PATH = scriptPath("../../", import.meta.url);
const UV_LOCK_FILE_PATH = scriptPath("uv.lock", import.meta.url);

runUpdateScript(import.meta.url, (args, runner) =>
  updateVersionedNixpkgsPythonUvLock({
    args,
    latestVersion: () =>
      latestGitHubVersion({ owner: "MinishLab", repo: "semble" }, fetchJsonClient),
    pinFilePath: PIN_FILE_PATH,
    project: (version, pythonMinorVersion) => ({
      dependencies: [`semble[mcp] @ git+https://github.com/MinishLab/semble.git@v${version}`],
      extraBuildDependencies: {
        semble: ["setuptools", "setuptools-scm"],
      },
      name: "sembleProject",
      pythonMinorVersion,
      version,
    }),
    pythonPackage: PYTHON_PACKAGE,
    repositoryRootPath: REPOSITORY_ROOT_PATH,
    runner,
    uvLockFilePath: UV_LOCK_FILE_PATH,
  }),
);
