import { gitHubRelease, latestGitHubVersion } from "coolheaded/latestVersion.ts";
import { runUpdateScript, scriptPath, updateNewerPinVersion } from "coolheaded/updateScript.ts";
import { Effect } from "effect";
import type { PackageHashConfig } from "coolheaded/packageConfigTypes.ts";
import type { SupportedSystem } from "coolheaded/system.ts";
import { releaseHashConfig } from "coolheaded/releaseUpdater.ts";
import { writePackageHashConfig } from "coolheaded/pinJson.ts";

const PIN_FILE_PATH = scriptPath("pin.json", import.meta.url);
const OXFMT_RELEASE_TARGETS = {
  "aarch64-darwin": "aarch64-apple-darwin",
  "aarch64-linux": "aarch64-unknown-linux-gnu",
  "x86_64-linux": "x86_64-unknown-linux-gnu",
} as const satisfies Readonly<Record<SupportedSystem, string>>;

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

function releaseAssetUrls(version: string): Readonly<Record<SupportedSystem, string>> {
  return {
    "aarch64-darwin": releaseAssetUrl(version, OXFMT_RELEASE_TARGETS["aarch64-darwin"]),
    "aarch64-linux": releaseAssetUrl(version, OXFMT_RELEASE_TARGETS["aarch64-linux"]),
    "x86_64-linux": releaseAssetUrl(version, OXFMT_RELEASE_TARGETS["x86_64-linux"]),
  };
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
  return Effect.map(
    Effect.all({
      binaryVersion: oxfmtBinaryVersion(version),
      config: releaseHashConfig(version, releaseAssetUrls(version), "sha256Digest"),
    }),
    ({ binaryVersion: resolvedBinaryVersion, config }): PackageHashConfig => ({
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
