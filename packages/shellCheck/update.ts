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

function latestVersion(jsonClient: JsonClient): ReturnType<typeof latestGitHubVersion> {
  return latestGitHubVersion({ owner: "koalaman", repo: "shellcheck" }, jsonClient);
}

const SHELLCHECK_RELEASE_TARGETS = {
  "aarch64-darwin": "darwin.aarch64",
  "aarch64-linux": "linux.aarch64",
  "x86_64-linux": "linux.x86_64",
} as const satisfies ReleaseTargets;

function releaseAssetUrl(version: string, target: string): string {
  return `https://github.com/koalaman/shellcheck/releases/download/v${version}/shellcheck-v${version}.${target}.tar.xz`;
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
      releaseUrlsFromTargets(SHELLCHECK_RELEASE_TARGETS, (target: string): string =>
        releaseAssetUrl(version, target),
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
