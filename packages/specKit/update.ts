import { runUpdateScript, scriptPath } from "coolheaded/core/updateScript.ts";
import { fetchJsonClient } from "coolheaded/core/fetchHttpClient.ts";
import { latestGitHubVersion } from "coolheaded/source/githubVersion.ts";
import { updateVersionedNixpkgsPythonUvLock } from "coolheaded/update/uvLock.ts";

const PIN_FILE_PATH = scriptPath("pin.json", import.meta.url);
const PYTHON_PACKAGE = "python313";
const REPOSITORY_ROOT_PATH = scriptPath("../../", import.meta.url);
const UV_LOCK_FILE_PATH = scriptPath("uv.lock", import.meta.url);

runUpdateScript(import.meta.url, (args, runner) =>
  updateVersionedNixpkgsPythonUvLock({
    args,
    latestVersion: () =>
      latestGitHubVersion(
        { owner: "github", repo: "spec-kit", source: "releases" },
        fetchJsonClient,
      ),
    pinFilePath: PIN_FILE_PATH,
    project: (version, pythonMinorVersion) => ({
      dependencies: [`specify-cli @ git+https://github.com/github/spec-kit.git@v${version}`],
      extraBuildDependencies: {
        "specify-cli": ["hatchling"],
      },
      name: "specKitProject",
      pythonMinorVersion,
      version,
    }),
    pythonPackage: PYTHON_PACKAGE,
    repositoryRootPath: REPOSITORY_ROOT_PATH,
    runner,
    uvLockFilePath: UV_LOCK_FILE_PATH,
  }),
);
