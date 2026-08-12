import { fetchHttpClient, fetchJsonClient } from "coolheaded/core/fetchHttpClient.ts";
import { releaseHashUpdateProgram, releaseUrlsFromTargets } from "coolheaded/update/release.ts";
import { runUpdateScript, scriptPath } from "coolheaded/core/updateScript.ts";
import { latestGitHubVersion } from "coolheaded/source/githubVersion.ts";

const PIN_FILE_PATH = scriptPath("pin.json", import.meta.url);
type ReleaseTargets = Parameters<typeof releaseUrlsFromTargets>[0];

const RELEASE_TARGETS = {
  "aarch64-darwin": "macOS_arm64.zip",
  "aarch64-linux": "linux_arm64.tar.gz",
  "x86_64-linux": "linux_amd64.tar.gz",
} as const satisfies ReleaseTargets;

runUpdateScript(import.meta.url, (args) =>
  releaseHashUpdateProgram({
    args,
    httpClient: fetchHttpClient,
    latestVersion: () =>
      latestGitHubVersion({ owner: "cli", repo: "cli", source: "releases" }, fetchJsonClient),
    pinFilePath: PIN_FILE_PATH,
    source: "sha256Digest",
    urlsForVersion: (version) =>
      releaseUrlsFromTargets(
        RELEASE_TARGETS,
        (target) =>
          `https://github.com/cli/cli/releases/download/v${version}/gh_${version}_${target}`,
      ),
  }),
);
