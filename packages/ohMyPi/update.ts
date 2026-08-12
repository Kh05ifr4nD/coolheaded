import { fetchHttpClient, fetchJsonClient } from "coolheaded/core/fetchHttpClient.ts";
import { releaseHashUpdateProgram, releaseUrlsFromTargets } from "coolheaded/update/release.ts";
import { runUpdateScript, scriptPath } from "coolheaded/core/updateScript.ts";
import { latestGitHubVersion } from "coolheaded/source/githubVersion.ts";

const PIN_FILE_PATH = scriptPath("pin.json", import.meta.url);
type ReleaseTargets = Parameters<typeof releaseUrlsFromTargets>[0];

const RELEASE_ASSETS = {
  "aarch64-darwin": "omp-darwin-arm64",
  "aarch64-linux": "omp-linux-arm64",
  "x86_64-linux": "omp-linux-x64",
} as const satisfies ReleaseTargets;

runUpdateScript(import.meta.url, (args) =>
  releaseHashUpdateProgram({
    args,
    httpClient: fetchHttpClient,
    latestVersion: () =>
      latestGitHubVersion(
        { owner: "can1357", repo: "oh-my-pi", source: "releases" },
        fetchJsonClient,
      ),
    pinFilePath: PIN_FILE_PATH,
    source: "sha256Digest",
    urlsForVersion: (version) =>
      releaseUrlsFromTargets(
        RELEASE_ASSETS,
        (target) => `https://github.com/can1357/oh-my-pi/releases/download/v${version}/${target}`,
      ),
  }),
);
