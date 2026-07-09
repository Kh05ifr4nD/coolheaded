import { UpdateError, runUpdateScript, scriptPath } from "coolheaded/core/updateScript.ts";
import { releaseHashUpdateProgram, releaseUrlsFromTargets } from "coolheaded/update/release.ts";
import { Effect } from "effect";

const INSTALL_SCRIPT_URL = "https://cursor.com/install";
const PIN_FILE_PATH = scriptPath("pin.json", import.meta.url);
const VERSION_PATTERN = /downloads\.cursor\.com\/lab\/(?<version>\d{4}\.\d{2}\.\d{2}-[0-9a-f]+)\//u;

type ReleaseTargets = Parameters<typeof releaseUrlsFromTargets>[0];

const RELEASE_ASSETS = {
  "aarch64-darwin": "darwin/arm64",
  "aarch64-linux": "linux/arm64",
  "x86_64-linux": "linux/x64",
} as const satisfies ReleaseTargets;

function parseLatestVersion(installScript: string): Effect.Effect<string, UpdateError> {
  const version = VERSION_PATTERN.exec(installScript)?.groups?.["version"];
  return typeof version === "string" && version.length > 0
    ? Effect.succeed(version)
    : Effect.fail(new UpdateError(`Missing Cursor CLI version in ${INSTALL_SCRIPT_URL}`));
}

function latestVersion(): Effect.Effect<string, Error> {
  return Effect.flatMap(
    Effect.tryPromise({
      catch(error: unknown): UpdateError {
        if (error instanceof UpdateError) {
          return error;
        }

        return new UpdateError(`Failed to fetch ${INSTALL_SCRIPT_URL}`);
      },
      async try(): Promise<string> {
        const response = await globalThis.fetch(INSTALL_SCRIPT_URL);
        if (!response.ok) {
          throw new UpdateError(`Failed to fetch ${INSTALL_SCRIPT_URL}: HTTP ${response.status}`);
        }

        return await response.text();
      },
    }),
    parseLatestVersion,
  );
}

function releaseAssetUrl(version: string, asset: string): string {
  return `https://downloads.cursor.com/lab/${version}/${asset}/agent-cli-package.tar.gz`;
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

export { main, parseLatestVersion };
