import {
  runUpdateScript,
  scriptPath,
  updateNewerPinVersion,
} from "coolheaded/core/updateScript.ts";
import { Effect } from "effect";
import { hexSha256ToSRI } from "coolheaded/update/release.ts";
import { latestGitHubVersion } from "coolheaded/source/version.ts";
import { systemRecord } from "coolheaded/system/target.ts";
import { writePackageHashConfig } from "coolheaded/pin/json.ts";

const PIN_FILE_PATH = scriptPath("pin.json", import.meta.url);
type SupportedSystem = Parameters<Parameters<typeof systemRecord>[0]>[0];

function latestVersion(): Effect.Effect<string, Error> {
  return latestGitHubVersion({
    owner: "colbymchenry",
    repo: "codegraph",
  });
}

const RELEASE_ASSETS = {
  "aarch64-darwin": "codegraph-darwin-arm64.tar.gz",
  "aarch64-linux": "codegraph-linux-arm64.tar.gz",
  "x86_64-linux": "codegraph-linux-x64.tar.gz",
} as const satisfies Readonly<Record<SupportedSystem, string>>;

function checksumUrl(version: string): string {
  return `https://github.com/colbymchenry/codegraph/releases/download/v${version}/SHA256SUMS`;
}

function fetchChecksums(version: string): Effect.Effect<string, Error> {
  const url = checksumUrl(version);

  return Effect.tryPromise({
    catch(error: unknown): Error {
      if (error instanceof Error) {
        return error;
      }

      return new Error(`Failed to fetch ${url}`);
    },
    async try(): Promise<string> {
      const response = await globalThis.fetch(url);
      if (!response.ok) {
        throw new Error(`Failed to fetch ${url}: HTTP ${response.status}`);
      }

      return await response.text();
    },
  });
}

function assetHash(checksums: string, asset: string): Effect.Effect<string, Error> {
  const line = checksums
    .split("\n")
    .find((entry: string): boolean => entry.trim().endsWith(` ${asset}`));

  if (line === undefined) {
    return Effect.fail(new Error(`Missing SHA256SUMS entry: ${asset}`));
  }

  const [hash] = line.trim().split(/\s+/u);
  if (typeof hash !== "string" || !/^[0-9a-f]{64}$/u.test(hash)) {
    return Effect.fail(new Error(`Invalid SHA256SUMS entry: ${asset}`));
  }

  return Effect.succeed(hexSha256ToSRI(hash));
}

function platformPackageHashes(
  checksums: string,
): Effect.Effect<Readonly<Record<SupportedSystem, string>>, Error> {
  return Effect.all(
    systemRecord(
      (system: SupportedSystem): Effect.Effect<string, Error> =>
        assetHash(checksums, RELEASE_ASSETS[system]),
    ),
  );
}

function updateProgram(args: readonly string[]): Effect.Effect<void, Error> {
  return updateNewerPinVersion(
    args,
    latestVersion,
    PIN_FILE_PATH,
    (version: string): Effect.Effect<void, Error> =>
      Effect.flatMap(
        Effect.flatMap(fetchChecksums(version), platformPackageHashes),
        (hashes): Effect.Effect<void> =>
          writePackageHashConfig(PIN_FILE_PATH, {
            platformPackageHashes: hashes,
            version,
          }),
      ),
  );
}

async function main(args: readonly string[]): Promise<void> {
  await Effect.runPromise(updateProgram(args));
}

runUpdateScript(import.meta.url, updateProgram);

export { main };
