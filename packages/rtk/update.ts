import { runUpdateScript, scriptPath } from "coolheaded/core/updateScript.ts";
import { fetchJsonClient } from "coolheaded/core/fetchHttpClient.ts";
import { latestGitHubVersion } from "coolheaded/source/githubVersion.ts";
import { updateGitHubRustPackagePin } from "coolheaded/update/rustPackage.ts";

const PIN_FILE_PATH = scriptPath("pin.json", import.meta.url);
const REPOSITORY_ROOT_PATH = scriptPath("../../", import.meta.url);
const PACKAGE = {
  owner: "rtk-ai",
  pname: "rtk",
  repo: "rtk",
  tag: (version: string): string => `v${version}`,
} as const;

runUpdateScript(import.meta.url, (args, runner) =>
  updateGitHubRustPackagePin({
    args,
    latestVersion: () =>
      latestGitHubVersion({ owner: PACKAGE.owner, repo: PACKAGE.repo }, fetchJsonClient),
    package: PACKAGE,
    pinFilePath: PIN_FILE_PATH,
    repositoryRootPath: REPOSITORY_ROOT_PATH,
    runner,
  }),
);
