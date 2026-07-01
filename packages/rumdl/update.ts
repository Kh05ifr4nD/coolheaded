import { releaseHashConfig, releaseUrlsFromTargets } from "coolheaded/releaseUpdater.ts";
import { runUpdateScript, scriptPath, updateNewerPinVersion } from "coolheaded/updateScript.ts";
import { Effect } from "effect";
import { latestGitHubVersion } from "coolheaded/latestVersion.ts";
import { writePackageHashConfig } from "coolheaded/pinJson.ts";

const RUMDL_RELEASE_VERSION_PREFIX = "v";
const PIN_FILE_PATH = scriptPath("pin.json", import.meta.url);
type ReleaseTargets = Parameters<typeof releaseUrlsFromTargets>[0];

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
} as const satisfies ReleaseTargets;

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

function updateProgram(args: readonly string[]): Effect.Effect<void, Error> {
  return updateNewerPinVersion(
    args,
    latestVersion,
    PIN_FILE_PATH,
    (version: string): Effect.Effect<void, Error> =>
      Effect.flatMap(
        releaseHashConfig(
          version,
          releaseUrlsFromTargets(RUMDL_RELEASE_TARGETS, (target: string): string =>
            sha256Url(version, target),
          ),
          "sha256Sum",
        ),
        (config): Effect.Effect<void> => writePackageHashConfig(PIN_FILE_PATH, config),
      ),
  );
}

async function main(args: readonly string[]): Promise<void> {
  await Effect.runPromise(updateProgram(args));
}

runUpdateScript(import.meta.url, updateProgram);

export { main };
