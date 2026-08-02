import type { HttpClient, JsonClient } from "coolheaded/core/httpClient.ts";
import { fetchHttpClient, fetchJsonClient } from "coolheaded/core/fetchHttpClient.ts";
import { releaseHashConfig, releaseUrlsFromTargets } from "coolheaded/update/release.ts";
import {
  requestedOrNewerPinVersion,
  runUpdateScript,
  scriptPath,
} from "coolheaded/core/updateScript.ts";
import { Effect } from "effect";
import { calendarVersionScheme } from "coolheaded/core/version.ts";
import { latestGitHubVersion } from "coolheaded/source/githubVersion.ts";
import { writePackageHashConfig } from "coolheaded/pin/json.ts";

const PIN_FILE_PATH = scriptPath("pin.json", import.meta.url);
type ReleaseTargets = Parameters<typeof releaseUrlsFromTargets>[0];

interface UpdateDependencies {
  readonly httpClient: HttpClient;
  readonly jsonClient: JsonClient;
  readonly pinFilePath: string;
}

const RELEASE_TARGETS = {
  "aarch64-darwin": "yt-dlp_macos",
  "aarch64-linux": "yt-dlp_linux_aarch64",
  "x86_64-linux": "yt-dlp_linux",
} as const satisfies ReleaseTargets;

function latestVersion(jsonClient: JsonClient): ReturnType<typeof latestGitHubVersion> {
  return latestGitHubVersion(
    {
      owner: "yt-dlp",
      repo: "yt-dlp",
      source: "releases",
      versionPattern: /^(?<version>\d{4}\.\d{2}\.\d{2})$/u,
      versionScheme: calendarVersionScheme,
    },
    jsonClient,
  );
}

function updateProgram(
  args: readonly string[],
  dependencies: UpdateDependencies,
): Effect.Effect<void, Error> {
  return Effect.flatMap(
    requestedOrNewerPinVersion(
      args,
      (): ReturnType<typeof latestGitHubVersion> => latestVersion(dependencies.jsonClient),
      dependencies.pinFilePath,
      calendarVersionScheme,
    ),
    (version: string | undefined): Effect.Effect<void, Error> =>
      version === undefined
        ? Effect.void
        : Effect.flatMap(
            releaseHashConfig(
              version,
              releaseUrlsFromTargets(
                RELEASE_TARGETS,
                (target: string): string =>
                  `https://github.com/yt-dlp/yt-dlp/releases/download/${version}/${target}`,
              ),
              "sha256Digest",
              dependencies.httpClient,
            ),
            (config): Effect.Effect<void> =>
              writePackageHashConfig(dependencies.pinFilePath, config),
          ),
  );
}

async function main(args: readonly string[], dependencies: UpdateDependencies): Promise<void> {
  await Effect.runPromise(updateProgram(args, dependencies));
}

function cliProgram(args: readonly string[]): Effect.Effect<void, Error> {
  return updateProgram(args, {
    httpClient: fetchHttpClient,
    jsonClient: fetchJsonClient,
    pinFilePath: PIN_FILE_PATH,
  });
}

runUpdateScript(import.meta.url, cliProgram);

export { main, updateProgram };
