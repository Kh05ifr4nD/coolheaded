import { fetchHttpClient, fetchJsonClient } from "coolheaded/core/fetchHttpClient.ts";
import { releaseHashUpdateProgram, releaseUrlsFromTargets } from "coolheaded/update/release.ts";
import { runUpdateScript, scriptPath } from "coolheaded/core/updateScript.ts";
import { latestGitHubVersion } from "coolheaded/source/githubVersion.ts";

const PIN_FILE_PATH = scriptPath("pin.json", import.meta.url);
type ReleaseTargets = Parameters<typeof releaseUrlsFromTargets>[0];

const SHFMT_RELEASE_TARGETS = {
  "aarch64-darwin": "darwin_arm64",
  "aarch64-linux": "linux_arm64",
  "x86_64-linux": "linux_amd64",
} as const satisfies ReleaseTargets;

runUpdateScript(import.meta.url, (args) =>
  releaseHashUpdateProgram({
    args,
    httpClient: fetchHttpClient,
    latestVersion: () => latestGitHubVersion({ owner: "mvdan", repo: "sh" }, fetchJsonClient),
    pinFilePath: PIN_FILE_PATH,
    source: "sha256Digest",
    urlsForVersion: (version) =>
      releaseUrlsFromTargets(
        SHFMT_RELEASE_TARGETS,
        (target) =>
          `https://github.com/mvdan/sh/releases/download/v${version}/shfmt_v${version}_${target}`,
      ),
  }),
);
