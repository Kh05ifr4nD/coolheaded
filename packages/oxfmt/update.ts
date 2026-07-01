import { gitHubRelease, latestGitHubVersion } from "coolheaded/source/version.ts";
import { releaseHashConfig, releaseUrlsFromTargets } from "coolheaded/update/release.ts";
import {
  runUpdateScript,
  scriptPath,
  updateNewerPinVersion,
} from "coolheaded/core/updateScript.ts";
import { Effect } from "effect";
import type { PackageHashConfig } from "coolheaded/pin/schema.ts";
import { writePackageHashConfig } from "coolheaded/pin/json.ts";

const PIN_FILE_PATH = scriptPath("pin.json", import.meta.url);
type ReleaseTargets = Parameters<typeof releaseUrlsFromTargets>[0];

const OXFMT_RELEASE_TARGETS = {
  "aarch64-darwin": "aarch64-apple-darwin",
  "aarch64-linux": "aarch64-unknown-linux-gnu",
  "x86_64-linux": "x86_64-unknown-linux-gnu",
} as const satisfies ReleaseTargets;

function latestVersion(): Effect.Effect<string, Error> {
  return latestGitHubVersion({
    owner: "oxc-project",
    repo: "oxc",
    source: "releases",
    versionPattern: /^apps_v(?<version>\d+\.\d+\.\d+)$/u,
  });
}

function releaseAssetUrl(version: string, target: string): string {
  return `https://github.com/oxc-project/oxc/releases/download/apps_v${version}/oxfmt-${target}.tar.gz`;
}

function binaryVersionFromReleaseTitle(title: string): Effect.Effect<string, Error> {
  const match = /\boxfmt v(?<binaryVersion>\d+\.\d+\.\d+)\b/u.exec(title);
  const resolvedBinaryVersion = match?.groups?.["binaryVersion"];

  return typeof resolvedBinaryVersion === "string"
    ? Effect.succeed(resolvedBinaryVersion)
    : Effect.fail(new Error(`Missing oxfmt binary version in release title: ${title}`));
}

function oxfmtBinaryVersion(version: string): Effect.Effect<string, Error> {
  return Effect.flatMap(
    gitHubRelease("oxc-project", "oxc", `apps_v${version}`),
    (release): Effect.Effect<string, Error> => binaryVersionFromReleaseTitle(release.name),
  );
}

function packageHashConfig(version: string): Effect.Effect<PackageHashConfig, Error> {
  const urls = releaseUrlsFromTargets(OXFMT_RELEASE_TARGETS, (target: string): string =>
    releaseAssetUrl(version, target),
  );
  const hashConfig = releaseHashConfig(version, urls, "sha256Digest");

  return Effect.map(
    Effect.all({
      binaryVersion: oxfmtBinaryVersion(version),
      hashConfig,
    }),
    ({ binaryVersion: resolvedBinaryVersion, hashConfig: config }): PackageHashConfig => ({
      ...config,
      binaryVersion: resolvedBinaryVersion,
    }),
  );
}

function updateProgram(args: readonly string[]): Effect.Effect<void, Error> {
  return updateNewerPinVersion(
    args,
    latestVersion,
    PIN_FILE_PATH,
    (version: string): Effect.Effect<void, Error> =>
      Effect.flatMap(
        packageHashConfig(version),
        (config): Effect.Effect<void> => writePackageHashConfig(PIN_FILE_PATH, config),
      ),
  );
}

async function main(args: readonly string[]): Promise<void> {
  await Effect.runPromise(updateProgram(args));
}

runUpdateScript(import.meta.url, updateProgram);

export { main };
