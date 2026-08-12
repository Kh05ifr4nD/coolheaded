import { fetchHttpClient, fetchJsonClient } from "coolheaded/core/fetchHttpClient.ts";
import { releaseHashUpdateProgram, releaseUrlsFromTargets } from "coolheaded/update/release.ts";
import { runUpdateScript, scriptPath } from "coolheaded/core/updateScript.ts";
import { latestGitHubVersion } from "coolheaded/source/githubVersion.ts";

const RUMDL_RELEASE_VERSION_PREFIX = "v";
const PIN_FILE_PATH = scriptPath("pin.json", import.meta.url);
type ReleaseTargets = Parameters<typeof releaseUrlsFromTargets>[0];

const RUMDL_RELEASE_TARGETS = {
  "aarch64-darwin": "aarch64-apple-darwin",
  "aarch64-linux": "aarch64-unknown-linux-gnu",
  "x86_64-linux": "x86_64-unknown-linux-gnu",
} as const satisfies ReleaseTargets;

runUpdateScript(import.meta.url, (args) =>
  releaseHashUpdateProgram({
    args,
    httpClient: fetchHttpClient,
    latestVersion: () => latestGitHubVersion({ owner: "rvben", repo: "rumdl" }, fetchJsonClient),
    pinFilePath: PIN_FILE_PATH,
    source: "sha256Sum",
    urlsForVersion: (version) =>
      releaseUrlsFromTargets(
        RUMDL_RELEASE_TARGETS,
        (target) =>
          `https://github.com/rvben/rumdl/releases/download/${RUMDL_RELEASE_VERSION_PREFIX}${version}/rumdl-${RUMDL_RELEASE_VERSION_PREFIX}${version}-${target}.tar.gz.sha256`,
      ),
  }),
);
