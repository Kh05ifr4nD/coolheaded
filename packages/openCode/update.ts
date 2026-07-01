import { releaseHashUpdateProgram, releaseUrlsFromTargets } from "coolheaded/releaseUpdater.ts";
import { runUpdateScript, scriptPath } from "coolheaded/updateScript.ts";
import { Effect } from "effect";
import { latestGitHubVersion } from "coolheaded/latestVersion.ts";

const PIN_FILE_PATH = scriptPath("pin.json", import.meta.url);
type ReleaseTargets = Parameters<typeof releaseUrlsFromTargets>[0];

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
} as const satisfies ReleaseTargets;

function releaseAssetUrl(version: string, asset: string): string {
  return `https://github.com/anomalyco/opencode/releases/download/v${version}/${asset}`;
}

function updateProgram(args: readonly string[]): Effect.Effect<void, Error> {
  return releaseHashUpdateProgram({
    args,
    latestVersion,
    pinFilePath: PIN_FILE_PATH,
    source: "sha256Digest",
    urlsForVersion: (version: string) =>
      releaseUrlsFromTargets(RELEASE_ASSETS, (target: string): string =>
        releaseAssetUrl(version, target),
      ),
  });
}

async function main(args: readonly string[]): Promise<void> {
  await Effect.runPromise(updateProgram(args));
}

runUpdateScript(import.meta.url, updateProgram);

export { main };
