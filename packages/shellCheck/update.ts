import { fetchHttpClient, fetchJsonClient } from "coolheaded/core/fetchHttpClient.ts";
import { releaseHashUpdateProgram, releaseUrlsFromTargets } from "coolheaded/update/release.ts";
import { runUpdateScript, scriptPath } from "coolheaded/core/updateScript.ts";
import { latestGitHubVersion } from "coolheaded/source/githubVersion.ts";

const PIN_FILE_PATH = scriptPath("pin.json", import.meta.url);
type ReleaseTargets = Parameters<typeof releaseUrlsFromTargets>[0];

const SHELLCHECK_RELEASE_TARGETS = {
  "aarch64-darwin": "darwin.aarch64",
  "aarch64-linux": "linux.aarch64",
  "x86_64-linux": "linux.x86_64",
} as const satisfies ReleaseTargets;

runUpdateScript(import.meta.url, (args) =>
  releaseHashUpdateProgram({
    args,
    httpClient: fetchHttpClient,
    latestVersion: () =>
      latestGitHubVersion({ owner: "koalaman", repo: "shellcheck" }, fetchJsonClient),
    pinFilePath: PIN_FILE_PATH,
    source: "sha256Digest",
    urlsForVersion: (version) =>
      releaseUrlsFromTargets(
        SHELLCHECK_RELEASE_TARGETS,
        (target) =>
          `https://github.com/koalaman/shellcheck/releases/download/v${version}/shellcheck-v${version}.${target}.tar.xz`,
      ),
  }),
);
