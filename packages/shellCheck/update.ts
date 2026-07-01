import { releaseHashUpdateProgram, releaseUrlsFromTargets } from "coolheaded/updates/release.ts";
import { runUpdateScript, scriptPath } from "coolheaded/core/updateScript.ts";
import { Effect } from "effect";
import { latestGitHubVersion } from "coolheaded/sources/latestVersion.ts";

const PIN_FILE_PATH = scriptPath("pin.json", import.meta.url);
type ReleaseTargets = Parameters<typeof releaseUrlsFromTargets>[0];

function latestVersion(): Effect.Effect<string, Error> {
  return latestGitHubVersion({
    owner: "koalaman",
    repo: "shellcheck",
  });
}

const SHELLCHECK_RELEASE_TARGETS = {
  "aarch64-darwin": "darwin.aarch64",
  "aarch64-linux": "linux.aarch64",
  "x86_64-linux": "linux.x86_64",
} as const satisfies ReleaseTargets;

function releaseAssetUrl(version: string, target: string): string {
  return `https://github.com/koalaman/shellcheck/releases/download/v${version}/shellcheck-v${version}.${target}.tar.xz`;
}

function updateProgram(args: readonly string[]): Effect.Effect<void, Error> {
  return releaseHashUpdateProgram({
    args,
    latestVersion,
    pinFilePath: PIN_FILE_PATH,
    source: "sha256Digest",
    urlsForVersion: (version: string) =>
      releaseUrlsFromTargets(SHELLCHECK_RELEASE_TARGETS, (target: string): string =>
        releaseAssetUrl(version, target),
      ),
  });
}

async function main(args: readonly string[]): Promise<void> {
  await Effect.runPromise(updateProgram(args));
}

runUpdateScript(import.meta.url, updateProgram);

export { main };
