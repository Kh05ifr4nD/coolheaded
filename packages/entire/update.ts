import { requestedOrLatestVersion, runUpdateScript, scriptPath } from "coolheaded/updateScript.ts";
import { Effect } from "effect";
import type { SupportedSystem } from "coolheaded/system.ts";
import { latestGitHubVersion } from "coolheaded/latestVersion.ts";
import { writePackageHashConfig } from "coolheaded/pinJson.ts";

const PIN_FILE_PATH = scriptPath("pin.json", import.meta.url);
const RELEASE_ASSETS = {
  "aarch64-darwin": "entire_darwin_arm64.tar.gz",
  "aarch64-linux": "entire_linux_arm64.tar.gz",
  "x86_64-linux": "entire_linux_amd64.tar.gz",
} as const satisfies Readonly<Record<SupportedSystem, string>>;

function latestVersion(): Effect.Effect<string, Error> {
  return latestGitHubVersion({
    owner: "entireio",
    repo: "cli",
  });
}

function checksumsUrl(version: string): string {
  return `https://github.com/entireio/cli/releases/download/v${version}/checksums.txt`;
}

function fetchChecksums(version: string): Effect.Effect<string, Error> {
  const url = checksumsUrl(version);

  return Effect.tryPromise({
    catch(error: unknown): Error {
      return error instanceof Error ? error : new Error(String(error));
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

function hexToSRI(hex: string): string {
  const bytes: number[] = [];

  for (let offset = 0; offset < hex.length; offset += 2) {
    bytes.push(Number.parseInt(hex.slice(offset, offset + 2), 16));
  }

  return `sha256-${globalThis.btoa(String.fromCodePoint(...bytes))}`;
}

function assetHash(checksums: string, asset: string): Effect.Effect<string, Error> {
  const line = checksums
    .split("\n")
    .find((entry: string): boolean => entry.trim().endsWith(` ${asset}`));

  if (line === undefined) {
    return Effect.fail(new Error(`Missing checksums entry: ${asset}`));
  }

  const [hash] = line.trim().split(/\s+/u);
  if (typeof hash !== "string" || !/^[0-9a-f]{64}$/u.test(hash)) {
    return Effect.fail(new Error(`Invalid checksums entry: ${asset}`));
  }

  return Effect.succeed(hexToSRI(hash));
}

function packageHashes(
  checksums: string,
): Effect.Effect<Readonly<Record<SupportedSystem, string>>, Error> {
  return Effect.all({
    "aarch64-darwin": assetHash(checksums, RELEASE_ASSETS["aarch64-darwin"]),
    "aarch64-linux": assetHash(checksums, RELEASE_ASSETS["aarch64-linux"]),
    "x86_64-linux": assetHash(checksums, RELEASE_ASSETS["x86_64-linux"]),
  });
}

function updateProgram(args: readonly string[]): Effect.Effect<void, Error> {
  return Effect.flatMap(
    requestedOrLatestVersion(args, latestVersion),
    (version: string): Effect.Effect<void, Error> =>
      Effect.flatMap(
        Effect.flatMap(fetchChecksums(version), packageHashes),
        (hashes): Effect.Effect<void> => writePackageHashConfig(PIN_FILE_PATH, { hashes, version }),
      ),
  );
}

async function main(args: readonly string[]): Promise<void> {
  await Effect.runPromise(updateProgram(args));
}

runUpdateScript(import.meta.url, updateProgram);

export { main };
