import { releaseHashUpdateProgram, releaseUrlsFromTargets } from "coolheaded/updates/release.ts";
import { runUpdateScript, scriptPath } from "coolheaded/core/updateScript.ts";
import { Effect } from "effect";
import { latestGitHubVersion } from "coolheaded/sources/latestVersion.ts";

const PIN_FILE_PATH = scriptPath("pin.json", import.meta.url);
type ReleaseTargets = Parameters<typeof releaseUrlsFromTargets>[0];

const OXLINT_RELEASE_TARGETS = {
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
  return `https://github.com/oxc-project/oxc/releases/download/apps_v${version}/oxlint-${target}.tar.gz`;
}

function updateProgram(args: readonly string[]): Effect.Effect<void, Error> {
  return releaseHashUpdateProgram({
    args,
    latestVersion,
    pinFilePath: PIN_FILE_PATH,
    source: "sha256Digest",
    urlsForVersion: (version: string) =>
      releaseUrlsFromTargets(OXLINT_RELEASE_TARGETS, (target: string): string =>
        releaseAssetUrl(version, target),
      ),
  });
}

async function main(args: readonly string[]): Promise<void> {
  await Effect.runPromise(updateProgram(args));
}

runUpdateScript(import.meta.url, updateProgram);

export { main };
