import { UpdateError, runUpdateScript, scriptPath } from "coolheaded/core/updateScript.ts";
import { releaseHashUpdateProgram, releaseUrlsFromTargets } from "coolheaded/update/release.ts";
import { Effect } from "effect";
import { isSemver } from "coolheaded/core/version.ts";

const PIN_FILE_PATH = scriptPath("pin.json", import.meta.url);
const STABLE_URL = "https://x.ai/cli/stable";
type ReleaseTargets = Parameters<typeof releaseUrlsFromTargets>[0];

const GROK_RELEASE_TARGETS = {
  "aarch64-darwin": "macos-aarch64",
  "aarch64-linux": "linux-aarch64",
  "x86_64-linux": "linux-x86_64",
} as const satisfies ReleaseTargets;

function latestVersion(): Effect.Effect<string, Error> {
  return Effect.tryPromise({
    catch(error: unknown): Error {
      return error instanceof UpdateError ? error : new UpdateError(String(error));
    },
    async try(): Promise<string> {
      const response = await globalThis.fetch(STABLE_URL);
      if (!response.ok) {
        throw new UpdateError(`Failed to fetch ${STABLE_URL}: HTTP ${response.status}`);
      }

      const responseText = await response.text();
      const version = responseText.trim();
      if (!isSemver(version)) {
        throw new UpdateError(`Invalid stable Grok version: ${JSON.stringify(version)}`);
      }

      return version;
    },
  });
}

function updateProgram(args: readonly string[]): Effect.Effect<void, Error> {
  return releaseHashUpdateProgram({
    args,
    latestVersion,
    pinFilePath: PIN_FILE_PATH,
    source: "sha256Digest",
    urlsForVersion: (version: string) =>
      releaseUrlsFromTargets(
        GROK_RELEASE_TARGETS,
        (target: string): string => `https://x.ai/cli/grok-${version}-${target}`,
      ),
  });
}

async function main(args: readonly string[]): Promise<void> {
  await Effect.runPromise(updateProgram(args));
}

runUpdateScript(import.meta.url, updateProgram);

export { main };
