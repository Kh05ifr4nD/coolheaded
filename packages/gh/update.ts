import type { HttpClient, JsonClient } from "coolheaded/core/httpClient.ts";
import { fetchHttpClient, fetchJsonClient } from "coolheaded/core/fetchHttpClient.ts";
import { releaseHashUpdateProgram, releaseUrlsFromTargets } from "coolheaded/update/release.ts";
import { runUpdateScript, scriptPath } from "coolheaded/core/updateScript.ts";
import { Effect } from "effect";
import { latestGitHubVersion } from "coolheaded/source/githubVersion.ts";

const PIN_FILE_PATH = scriptPath("pin.json", import.meta.url);
type GitHubVersionError = Effect.Effect.Error<ReturnType<typeof latestGitHubVersion>>;
type ReleaseTargets = Parameters<typeof releaseUrlsFromTargets>[0];

interface UpdateDependencies {
  readonly httpClient: HttpClient;
  readonly jsonClient: JsonClient;
}

const RELEASE_TARGETS = {
  "aarch64-darwin": "macOS_arm64.zip",
  "aarch64-linux": "linux_arm64.tar.gz",
  "x86_64-linux": "linux_amd64.tar.gz",
} as const satisfies ReleaseTargets;

function latestVersion(jsonClient: JsonClient): ReturnType<typeof latestGitHubVersion> {
  return latestGitHubVersion({ owner: "cli", repo: "cli", source: "releases" }, jsonClient);
}

function updateProgram(
  args: readonly string[],
  dependencies: UpdateDependencies,
): ReturnType<typeof releaseHashUpdateProgram<GitHubVersionError>> {
  return releaseHashUpdateProgram({
    args,
    httpClient: dependencies.httpClient,
    latestVersion: (): ReturnType<typeof latestGitHubVersion> =>
      latestVersion(dependencies.jsonClient),
    pinFilePath: PIN_FILE_PATH,
    source: "sha256Digest",
    urlsForVersion: (version: string) =>
      releaseUrlsFromTargets(
        RELEASE_TARGETS,
        (target: string): string =>
          `https://github.com/cli/cli/releases/download/v${version}/gh_${version}_${target}`,
      ),
  });
}

async function main(args: readonly string[], dependencies: UpdateDependencies): Promise<void> {
  await Effect.runPromise(updateProgram(args, dependencies));
}

function cliProgram(
  args: readonly string[],
): ReturnType<typeof releaseHashUpdateProgram<GitHubVersionError>> {
  return updateProgram(args, { httpClient: fetchHttpClient, jsonClient: fetchJsonClient });
}

runUpdateScript(import.meta.url, cliProgram);

export { main };
