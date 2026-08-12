import { fetchHttpClient, fetchJsonClient } from "coolheaded/core/fetchHttpClient.ts";
import { releaseHashUpdateProgram, releaseUrlsFromTargets } from "coolheaded/update/release.ts";
import { runUpdateScript, scriptPath } from "coolheaded/core/updateScript.ts";
import { calendarVersionScheme } from "coolheaded/core/version.ts";
import { latestGitHubVersion } from "coolheaded/source/githubVersion.ts";

const PIN_FILE_PATH = scriptPath("pin.json", import.meta.url);
type ReleaseTargets = Parameters<typeof releaseUrlsFromTargets>[0];

const RELEASE_TARGETS = {
  "aarch64-darwin": "yt-dlp_macos",
  "aarch64-linux": "yt-dlp_linux_aarch64",
  "x86_64-linux": "yt-dlp_linux",
} as const satisfies ReleaseTargets;

runUpdateScript(import.meta.url, (args) =>
  releaseHashUpdateProgram({
    args,
    httpClient: fetchHttpClient,
    latestVersion: () =>
      latestGitHubVersion(
        {
          owner: "yt-dlp",
          repo: "yt-dlp",
          source: "releases",
          versionPattern: /^(?<version>\d{4}\.\d{2}\.\d{2})$/u,
          versionScheme: calendarVersionScheme,
        },
        fetchJsonClient,
      ),
    pinFilePath: PIN_FILE_PATH,
    source: "sha256Digest",
    urlsForVersion: (version) =>
      releaseUrlsFromTargets(
        RELEASE_TARGETS,
        (target) => `https://github.com/yt-dlp/yt-dlp/releases/download/${version}/${target}`,
      ),
    versionScheme: calendarVersionScheme,
  }),
);
