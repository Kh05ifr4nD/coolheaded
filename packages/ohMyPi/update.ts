import { releaseHashUpdateProgram, releaseUrlsFromTargets } from "coolheaded/updates/release.ts";
import { runUpdateScript, scriptPath } from "coolheaded/core/updateScript.ts";
import { Effect } from "effect";
import { latestGitHubVersion } from "coolheaded/sources/latestVersion.ts";

const PIN_FILE_PATH = scriptPath("pin.json", import.meta.url);
type ReleaseTargets = Parameters<typeof releaseUrlsFromTargets>[0];

function latestVersion(): Effect.Effect<string, Error> {
  return latestGitHubVersion({
    owner: "can1357",
    repo: "oh-my-pi",
    source: "releases",
  });
}

const RELEASE_ASSETS = {
  "aarch64-darwin": "omp-darwin-arm64",
  "aarch64-linux": "omp-linux-arm64",
  "x86_64-linux": "omp-linux-x64",
} as const satisfies ReleaseTargets;

function releaseAssetUrl(version: string, asset: string): string {
  return `https://github.com/can1357/oh-my-pi/releases/download/v${version}/${asset}`;
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
