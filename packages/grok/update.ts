import { UpdateError, runUpdateScript, scriptPath } from "coolheaded/core/updateScript.ts";
import { releaseHashUpdateProgram, releaseUrlsFromTargets } from "coolheaded/update/release.ts";
import { Effect } from "effect";
import { isSemver } from "coolheaded/core/version.ts";

const PIN_FILE_PATH = scriptPath("pin.json", import.meta.url);
const STABLE_VERSION_URL = "https://x.ai/cli/stable";
type ReleaseTargets = Parameters<typeof releaseUrlsFromTargets>[0];

const RELEASE_ASSETS = {
  "aarch64-darwin": "macos-aarch64",
  "aarch64-linux": "linux-aarch64",
  "x86_64-linux": "linux-x86_64",
} as const satisfies ReleaseTargets;

function latestVersion(): Effect.Effect<string, Error> {
  return Effect.tryPromise({
    catch(error: unknown): UpdateError {
      if (error instanceof UpdateError) {
        return error;
      }

      return new UpdateError(`Failed to fetch ${STABLE_VERSION_URL}`);
    },
    async try(): Promise<string> {
      const response = await globalThis.fetch(STABLE_VERSION_URL);
      if (!response.ok) {
        throw new UpdateError(`Failed to fetch ${STABLE_VERSION_URL}: HTTP ${response.status}`);
      }

      const responseText = await response.text();
      const version = responseText.trim();
      if (!isSemver(version)) {
        throw new UpdateError(`Invalid Grok stable version: ${version}`);
      }

      return version;
    },
  });
}

function releaseAssetUrl(version: string, asset: string): string {
  return `https://storage.googleapis.com/grok-build-public-artifacts/cli/grok-${version}-${asset}`;
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
