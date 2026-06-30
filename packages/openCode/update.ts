import { runUpdateScript, scriptPath, updateNewerPinVersion } from "coolheaded/updateScript.ts";
import { Effect } from "effect";
import type { SupportedSystem } from "coolheaded/system.ts";
import { latestGitHubVersion } from "coolheaded/latestVersion.ts";
import { releaseHashConfig } from "coolheaded/releaseUpdater.ts";
import { writePackageHashConfig } from "coolheaded/pinJson.ts";

const PIN_FILE_PATH = scriptPath("pin.json", import.meta.url);
function latestVersion(): Effect.Effect<string, Error> {
  return latestGitHubVersion({
    owner: "anomalyco",
    repo: "opencode",
    source: "releases",
  });
}

const RELEASE_ASSETS = {
  "aarch64-darwin": "opencode-darwin-arm64.zip",
  "aarch64-linux": "opencode-linux-arm64.tar.gz",
  "x86_64-linux": "opencode-linux-x64.tar.gz",
} as const satisfies Readonly<Record<SupportedSystem, string>>;

function releaseAssetUrl(version: string, asset: string): string {
  return `https://github.com/anomalyco/opencode/releases/download/v${version}/${asset}`;
}

function releaseAssetUrls(version: string): Readonly<Record<SupportedSystem, string>> {
  return {
    "aarch64-darwin": releaseAssetUrl(version, RELEASE_ASSETS["aarch64-darwin"]),
    "aarch64-linux": releaseAssetUrl(version, RELEASE_ASSETS["aarch64-linux"]),
    "x86_64-linux": releaseAssetUrl(version, RELEASE_ASSETS["x86_64-linux"]),
  };
}

function updateProgram(args: readonly string[]): Effect.Effect<void, Error> {
  return updateNewerPinVersion(
    args,
    latestVersion,
    PIN_FILE_PATH,
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
