import { runUpdateScript, scriptPath } from "coolheaded/core/updateScript.ts";
import { fetchJsonClient } from "coolheaded/core/fetchHttpClient.ts";
import { latestGitHubVersion } from "coolheaded/source/githubVersion.ts";
import { updateGitHubSourcePin } from "coolheaded/source/github.ts";

const PIN_FILE_PATH = scriptPath("pin.json", import.meta.url);
const REPOSITORY_ROOT_PATH = scriptPath("../../", import.meta.url);
const GITHUB_SOURCE = {
  owner: "MinishLab",
  repo: "semble",
  tag: (version: string): string => `v${version}`,
};

runUpdateScript(import.meta.url, (args, runner) =>
  updateGitHubSourcePin({
    args,
    latestVersion: () =>
      latestGitHubVersion(
        { owner: GITHUB_SOURCE.owner, repo: GITHUB_SOURCE.repo },
        fetchJsonClient,
      ),
    pinFilePath: PIN_FILE_PATH,
    repositoryRootPath: REPOSITORY_ROOT_PATH,
    runner,
    source: GITHUB_SOURCE,
  }),
);
