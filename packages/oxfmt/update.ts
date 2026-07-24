import type { HttpClient, JsonClient } from "coolheaded/core/httpClient.ts";
import {
  UpdateError,
  runUpdateScript,
  scriptPath,
  updateNewerPinVersion,
} from "coolheaded/core/updateScript.ts";
import { fetchHttpClient, fetchJsonClient } from "coolheaded/core/fetchHttpClient.ts";
import { gitHubRelease, latestGitHubVersion } from "coolheaded/source/githubVersion.ts";
import { releaseHashConfig, releaseUrlsFromTargets } from "coolheaded/update/release.ts";
import { Effect } from "effect";
import type { PackageHashConfig } from "coolheaded/pin/packageHashConfig.ts";
import { writePackageHashConfig } from "coolheaded/pin/json.ts";

const PIN_FILE_PATH = scriptPath("pin.json", import.meta.url);
type ReleaseTargets = Parameters<typeof releaseUrlsFromTargets>[0];

const OXFMT_RELEASE_TARGETS = {
  "aarch64-darwin": "aarch64-apple-darwin",
  "aarch64-linux": "aarch64-unknown-linux-gnu",
  "x86_64-linux": "x86_64-unknown-linux-gnu",
} as const satisfies ReleaseTargets;

interface UpdateDependencies {
  readonly httpClient: HttpClient;
  readonly jsonClient: JsonClient;
}

type GitHubReleaseError = Effect.Effect.Error<ReturnType<typeof gitHubRelease>>;
type LatestVersionError = Effect.Effect.Error<ReturnType<typeof latestVersion>>;
type ReleaseHashError = Effect.Effect.Error<ReturnType<typeof releaseHashConfig>>;
type UpdateVersionError = GitHubReleaseError | ReleaseHashError | UpdateError;

function latestVersion(jsonClient: JsonClient): ReturnType<typeof latestGitHubVersion> {
  return latestGitHubVersion(
    {
      owner: "oxc-project",
      repo: "oxc",
      source: "releases",
      versionPattern: /^apps_v(?<version>\d+\.\d+\.\d+)$/u,
    },
    jsonClient,
  );
}

function releaseAssetUrl(version: string, target: string): string {
  return `https://github.com/oxc-project/oxc/releases/download/apps_v${version}/oxfmt-${target}.tar.gz`;
}

function binaryVersionFromReleaseTitle(title: string): Effect.Effect<string, UpdateError> {
  const match = /\boxfmt v(?<binaryVersion>\d+\.\d+\.\d+)\b/u.exec(title);
  const resolvedBinaryVersion = match?.groups?.["binaryVersion"];

  return typeof resolvedBinaryVersion === "string"
    ? Effect.succeed(resolvedBinaryVersion)
    : Effect.fail(new UpdateError(`Missing oxfmt binary version in release title: ${title}`));
}

function oxfmtBinaryVersion(
  version: string,
  jsonClient: JsonClient,
): Effect.Effect<string, GitHubReleaseError | UpdateError> {
  return Effect.flatMap(
    gitHubRelease("oxc-project", "oxc", `apps_v${version}`, jsonClient),
    (release): Effect.Effect<string, UpdateError> => binaryVersionFromReleaseTitle(release.name),
  );
}

function packageHashConfig(
  version: string,
  dependencies: UpdateDependencies,
): Effect.Effect<PackageHashConfig, UpdateVersionError> {
  const urls = releaseUrlsFromTargets(OXFMT_RELEASE_TARGETS, (target: string): string =>
    releaseAssetUrl(version, target),
  );
  const hashConfig = releaseHashConfig(version, urls, "sha256Digest", dependencies.httpClient);

  return Effect.map(
    Effect.all({
      binaryVersion: oxfmtBinaryVersion(version, dependencies.jsonClient),
      hashConfig,
    }),
    ({ binaryVersion: resolvedBinaryVersion, hashConfig: config }): PackageHashConfig => ({
      ...config,
      binaryVersion: resolvedBinaryVersion,
    }),
  );
}

function updateProgram(
  args: readonly string[],
  dependencies: UpdateDependencies,
): ReturnType<typeof updateNewerPinVersion<LatestVersionError, UpdateVersionError>> {
  return updateNewerPinVersion(
    args,
    (): ReturnType<typeof latestVersion> => latestVersion(dependencies.jsonClient),
    PIN_FILE_PATH,
    (version: string): Effect.Effect<void, UpdateVersionError> =>
      Effect.flatMap(
        packageHashConfig(version, dependencies),
        (config): Effect.Effect<void> => writePackageHashConfig(PIN_FILE_PATH, config),
      ),
  );
}

async function main(args: readonly string[], dependencies: UpdateDependencies): Promise<void> {
  await Effect.runPromise(updateProgram(args, dependencies));
}

function cliProgram(
  args: readonly string[],
): ReturnType<typeof updateNewerPinVersion<LatestVersionError, UpdateVersionError>> {
  return updateProgram(args, { httpClient: fetchHttpClient, jsonClient: fetchJsonClient });
}

runUpdateScript(import.meta.url, cliProgram);

export { main };
