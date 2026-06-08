import { requestedOrLatestVersion, runUpdateScript, scriptPath } from "coolheaded/updateScript.ts";
import { Effect } from "effect";
import type { SupportedSystem } from "coolheaded/system.ts";
import { latestGitHubVersion } from "coolheaded/latestVersion.ts";
import { releaseHashConfig } from "coolheaded/releaseUpdater.ts";
import { writePackageHashConfig } from "coolheaded/pinJson.ts";

const PIN_FILE_PATH = scriptPath("pin.json", import.meta.url);
function latestVersion(): Effect.Effect<string, Error> {
  return latestGitHubVersion({
    owner: "rhysd",
    repo: "actionlint",
  });
}

const ACTIONLINT_RELEASE_TARGETS = {
  "aarch64-darwin": "darwin_arm64",
  "aarch64-linux": "linux_arm64",
  "x86_64-linux": "linux_amd64",
} as const satisfies Readonly<Record<SupportedSystem, string>>;

function releaseAssetName(version: string, target: string): string {
  return `actionlint_${version}_${target}.tar.gz`;
}

function releaseAssetUrl(version: string, target: string): string {
  const asset = releaseAssetName(version, target);
  return `https://github.com/rhysd/actionlint/releases/download/v${version}/${asset}`;
}

function releaseAssetUrls(version: string): Readonly<Record<SupportedSystem, string>> {
  return {
    "aarch64-darwin": releaseAssetUrl(version, ACTIONLINT_RELEASE_TARGETS["aarch64-darwin"]),
    "aarch64-linux": releaseAssetUrl(version, ACTIONLINT_RELEASE_TARGETS["aarch64-linux"]),
    "x86_64-linux": releaseAssetUrl(version, ACTIONLINT_RELEASE_TARGETS["x86_64-linux"]),
  };
}

function updateProgram(args: readonly string[]): Effect.Effect<void, Error> {
  return Effect.flatMap(
    requestedOrLatestVersion(args, latestVersion),
    (version: string): Effect.Effect<void, Error> =>
      Effect.flatMap(
        releaseHashConfig(version, releaseAssetUrls(version), "sha256Digest"),
        (config): Effect.Effect<void> => writePackageHashConfig(PIN_FILE_PATH, config),
      ),
  );
}

async function main(args: readonly string[]): Promise<void> {
  await Effect.runPromise(updateProgram(args));
}

runUpdateScript(import.meta.url, updateProgram);

export { main };
