import {
  requestedOrLatestVersion,
  runUpdateScript,
  scriptPath,
} from "coolheaded/updateScript.ts";
import { Effect } from "effect";
import type { SupportedSystem } from "coolheaded/system.ts";
import { latestGitHubVersion } from "coolheaded/latestVersion.ts";
import { writePackageHashConfig } from "coolheaded/pinJson.ts";

const HEX_BYTE_WIDTH = 2;
const HEX_RADIX = 16;
const PIN_FILE_PATH = scriptPath("pin.json", import.meta.url);
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
        throw new Error(
          `Failed to fetch ${url}: HTTP ${response.status}`,
        );
      }

      return await response.text();
    },
  });
}

function hexToBytes(hex: string): Uint8Array {
  const bytes: number[] = [];

  for (let offset = 0; offset < hex.length; offset += HEX_BYTE_WIDTH) {
    bytes.push(
      Number.parseInt(
        hex.slice(offset, offset + HEX_BYTE_WIDTH),
        HEX_RADIX,
      ),
    );
  }

  return Uint8Array.from(bytes);
}

function hexSha256ToSRI(hex: string): string {
  return `sha256-${globalThis.btoa(String.fromCodePoint(...hexToBytes(hex)))}`;
}

function assetHash(
  checksums: string,
  asset: string,
): Effect.Effect<string, Error> {
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

function packageHashes(
  checksums: string,
): Effect.Effect<Readonly<Record<SupportedSystem, string>>, Error> {
  return Effect.all({
    "aarch64-darwin": assetHash(
      checksums,
      RELEASE_ASSETS["aarch64-darwin"],
    ),
    "aarch64-linux": assetHash(
      checksums,
      RELEASE_ASSETS["aarch64-linux"],
    ),
    "x86_64-linux": assetHash(
      checksums,
      RELEASE_ASSETS["x86_64-linux"],
    ),
  });
}

function updateProgram(args: readonly string[]): Effect.Effect<void, Error> {
  return Effect.flatMap(
    requestedOrLatestVersion(args, latestVersion),
    (version: string): Effect.Effect<void, Error> =>
      Effect.flatMap(
        Effect.flatMap(fetchChecksums(version), packageHashes),
        (hashes): Effect.Effect<void> =>
          writePackageHashConfig(PIN_FILE_PATH, { hashes, version }),
      ),
  );
}

async function main(args: readonly string[]): Promise<void> {
  await Effect.runPromise(updateProgram(args));
}

runUpdateScript(import.meta.url, updateProgram);

export { main };
