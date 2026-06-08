import { requestedOrLatestVersion, runUpdateScript, scriptPath } from "coolheaded/updateScript.ts";
import { Effect } from "effect";
import type { SupportedSystem } from "coolheaded/system.ts";
import { latestGitHubVersion } from "coolheaded/latestVersion.ts";
import { releaseHashConfig } from "coolheaded/releaseUpdater.ts";
import { writePackageHashConfig } from "coolheaded/pinJson.ts";

const RUMDL_RELEASE_VERSION_PREFIX = "v";
const PIN_FILE_PATH = scriptPath("pin.json", import.meta.url);
function latestVersion(): Effect.Effect<string, Error> {
  return latestGitHubVersion({
    owner: "rvben",
    repo: "rumdl",
  });
}

const RUMDL_RELEASE_TARGETS = {
  "aarch64-darwin": "aarch64-apple-darwin",
  "aarch64-linux": "aarch64-unknown-linux-gnu",
  "x86_64-linux": "x86_64-unknown-linux-gnu",
} as const satisfies Readonly<Record<SupportedSystem, string>>;

function releaseAssetName(version: string, target: string): string {
  return `rumdl-${RUMDL_RELEASE_VERSION_PREFIX}${version}-${target}.tar.gz`;
}

function releaseAssetUrl(version: string, target: string): string {
  const asset = releaseAssetName(version, target);
  return `https://github.com/rvben/rumdl/releases/download/${RUMDL_RELEASE_VERSION_PREFIX}${version}/${asset}`;
}

function sha256Url(version: string, target: string): string {
  return `${releaseAssetUrl(version, target)}.sha256`;
}

function sha256Urls(version: string): Readonly<Record<SupportedSystem, string>> {
  return {
    "aarch64-darwin": sha256Url(version, RUMDL_RELEASE_TARGETS["aarch64-darwin"]),
    "aarch64-linux": sha256Url(version, RUMDL_RELEASE_TARGETS["aarch64-linux"]),
    "x86_64-linux": sha256Url(version, RUMDL_RELEASE_TARGETS["x86_64-linux"]),
  };
}

function updateProgram(args: readonly string[]): Effect.Effect<void, Error> {
  return Effect.flatMap(
    requestedOrLatestVersion(args, latestVersion),
    (version: string): Effect.Effect<void, Error> =>
      Effect.flatMap(
        releaseHashConfig(version, sha256Urls(version), "sha256Sum"),
        (config): Effect.Effect<void> => writePackageHashConfig(PIN_FILE_PATH, config),
      ),
  );
}

async function main(args: readonly string[]): Promise<void> {
  await Effect.runPromise(updateProgram(args));
}

runUpdateScript(import.meta.url, updateProgram);

export { main };
