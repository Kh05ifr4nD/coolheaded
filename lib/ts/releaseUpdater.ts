import { Effect } from "effect";
import type { PackageHashConfig } from "./packageConfigTypes.ts";
import { UpdateError } from "./updateScript.ts";
import { parsePackageHashConfig } from "./packageConfig.ts";
import { systemRecord } from "./system.ts";

const HEX_BYTE_WIDTH = 2;
const HEX_RADIX = 16;

type ReleaseHashSource = "sha256Digest" | "sha256Sum";
type SupportedSystem = Parameters<Parameters<typeof systemRecord>[0]>[0];
type ReleaseTargets = Readonly<Record<SupportedSystem, string>>;
type ReleaseUrls = Readonly<Record<SupportedSystem, string>>;

function fetchText(url: string): Effect.Effect<string, UpdateError> {
  return Effect.tryPromise({
    catch(error: unknown): UpdateError {
      if (error instanceof UpdateError) {
        return error;
      }

      return new UpdateError(`Failed to fetch ${url}`);
    },
    async try(): Promise<string> {
      const response = await globalThis.fetch(url);
      if (!response.ok) {
        throw new UpdateError(`Failed to fetch ${url}: HTTP ${response.status}`);
      }

      return await response.text();
    },
  });
}

function parseSha256Hex(text: string, url: string): Effect.Effect<string, UpdateError> {
  const [hash] = text.trim().split(/\s+/u);
  if (typeof hash === "string" && /^[0-9a-f]{64}$/u.test(hash)) {
    return Effect.succeed(hash);
  }

  return Effect.fail(new UpdateError(`Invalid sha256 from ${url}`));
}

function hexToBytes(hex: string): Uint8Array {
  const bytes: number[] = [];

  for (let offset = 0; offset < hex.length; offset += HEX_BYTE_WIDTH) {
    bytes.push(Number.parseInt(hex.slice(offset, offset + HEX_BYTE_WIDTH), HEX_RADIX));
  }

  return Uint8Array.from(bytes);
}

function bytesToSha256SRI(bytes: readonly number[]): string {
  return `sha256-${globalThis.btoa(String.fromCodePoint(...bytes))}`;
}

function hexSha256ToSRI(hex: string): string {
  return bytesToSha256SRI([...hexToBytes(hex)]);
}

function releaseUrlsFromTargets(
  targets: ReleaseTargets,
  urlForTarget: (target: string) => string,
): ReleaseUrls {
  return systemRecord((system: SupportedSystem): string => urlForTarget(targets[system]));
}

function fetchSha256SumHash(url: string): Effect.Effect<string, UpdateError> {
  return Effect.flatMap(
    fetchText(url),
    (text: string): Effect.Effect<string, UpdateError> =>
      Effect.map(parseSha256Hex(text, url), hexSha256ToSRI),
  );
}

function fetchSha256DigestHash(url: string): Effect.Effect<string, UpdateError> {
  return Effect.tryPromise({
    catch(error: unknown): UpdateError {
      if (error instanceof UpdateError) {
        return error;
      }

      return new UpdateError(`Failed to fetch ${url}`);
    },
    async try(): Promise<string> {
      const response = await globalThis.fetch(url);
      if (!response.ok) {
        throw new UpdateError(`Failed to fetch ${url}: HTTP ${response.status}`);
      }

      const digest = await globalThis.crypto.subtle.digest("SHA-256", await response.arrayBuffer());
      return bytesToSha256SRI([...new Uint8Array(digest)]);
    },
  });
}

function hashForUrl(source: ReleaseHashSource, url: string): Effect.Effect<string, UpdateError> {
  switch (source) {
    case "sha256Digest": {
      return fetchSha256DigestHash(url);
    }
    case "sha256Sum": {
      return fetchSha256SumHash(url);
    }
    default: {
      return Effect.fail(new UpdateError("Unsupported release hash source"));
    }
  }
}

function releaseHashes(
  urls: ReleaseUrls,
  source: ReleaseHashSource,
): Effect.Effect<Readonly<Record<SupportedSystem, string>>, UpdateError> {
  return Effect.all(
    systemRecord(
      (system: SupportedSystem): Effect.Effect<string, UpdateError> =>
        hashForUrl(source, urls[system]),
    ),
  );
}

function releaseHashConfig(
  version: string,
  urls: ReleaseUrls,
  source: ReleaseHashSource,
): Effect.Effect<PackageHashConfig, UpdateError> {
  return Effect.map(
    releaseHashes(urls, source),
    (platformPackageHashes: Readonly<Record<SupportedSystem, string>>): PackageHashConfig =>
      parsePackageHashConfig({ platformPackageHashes, version }),
  );
}

export { hexSha256ToSRI, releaseHashConfig, releaseUrlsFromTargets };
export type { ReleaseHashSource, ReleaseTargets, ReleaseUrls };
