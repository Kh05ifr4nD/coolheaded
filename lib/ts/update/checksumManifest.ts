import type {
  HttpClient,
  HttpClientError,
  HttpRequest,
  HttpResponse,
} from "coolheaded/core/httpClient.ts";
import { UpdateError, updateNewerPinVersion } from "coolheaded/core/updateScript.ts";
import { Effect } from "effect";
import type { VersionScheme } from "coolheaded/core/version.ts";
import { formatSriHash } from "coolheaded/pin/sriHash.ts";
import { systemRecord } from "coolheaded/system/target.ts";
import { writePackageHashConfig } from "coolheaded/pin/json.ts";

const HEX_RADIX = 16;
const REQUEST_TIMEOUT_MS = 30_000;

type ChecksumManifestErrorKind = "duplicate" | "malformed" | "mismatch" | "missing";

class ChecksumManifestError extends Error {
  public readonly actual: string | undefined;
  public readonly asset: string;
  public readonly expected: string | undefined;
  public readonly kind: ChecksumManifestErrorKind;

  public constructor(
    kind: ChecksumManifestErrorKind,
    asset: string,
    message: string,
    expected?: string,
    actual?: string,
  ) {
    super(message);
    this.actual = actual;
    this.asset = asset;
    this.expected = expected;
    this.kind = kind;
    this.name = "ChecksumManifestError";
  }
}

type SriHash = ReturnType<typeof formatSriHash>;
type ChecksumManifestResult = Readonly<Record<string, SriHash>>;
type ChecksumVerificationError = ChecksumManifestError | HttpClientError;
type SupportedSystem = Parameters<Parameters<typeof systemRecord>[0]>[0];

interface ChecksumManifestUpdateOptions<LatestVersionError extends Error> {
  readonly args: readonly string[];
  readonly assets: Readonly<Record<SupportedSystem, string>>;
  readonly assetUrl: (version: string, asset: string) => string;
  readonly httpClient: HttpClient;
  readonly latestVersion: () => Effect.Effect<string, LatestVersionError>;
  readonly manifestUrl: (version: string) => string;
  readonly pinFilePath: string;
  readonly versionScheme?: VersionScheme;
}

function malformed(asset: string): ChecksumManifestError {
  return new ChecksumManifestError("malformed", asset, `Malformed checksum manifest: ${asset}`);
}

function parseChecksumManifest(
  manifest: string,
  assets: readonly string[],
): Effect.Effect<Readonly<Record<string, string>>, ChecksumManifestError> {
  const requested = new Set(assets);
  const selected: Record<string, string> = {};
  for (const line of manifest.split("\n")) {
    if (line.length > 0) {
      const match = /^(?<hash>[0-9a-f]{64}) (?<marker>[ *])(?<filename>.+)$/u.exec(line);
      const hash = match?.groups?.["hash"];
      const filename = match?.groups?.["filename"];
      if (typeof hash !== "string" || typeof filename !== "string") {
        return Effect.fail(malformed("manifest"));
      }
      if (requested.has(filename)) {
        if (Object.hasOwn(selected, filename)) {
          return Effect.fail(
            new ChecksumManifestError("duplicate", filename, `Duplicate checksum: ${filename}`),
          );
        }
        selected[filename] = hash;
      }
    }
  }
  for (const asset of assets) {
    if (!Object.hasOwn(selected, asset)) {
      return Effect.fail(new ChecksumManifestError("missing", asset, `Missing checksum: ${asset}`));
    }
  }
  return Effect.succeed(selected);
}

function httpRequest(url: string): HttpRequest {
  return {
    headers: {},
    method: "GET",
    timeoutMs: REQUEST_TIMEOUT_MS,
    url,
  };
}

function responseText<Response extends HttpResponse>(
  response: Response,
): Effect.Effect<string, ChecksumManifestError> & Readonly<{ readonly response?: Response }> {
  return Effect.try({
    catch: (): ChecksumManifestError => malformed("manifest"),
    try: (): string => new globalThis.TextDecoder("utf8", { fatal: true }).decode(response.body),
  });
}

function digestHex(
  bytes: readonly number[],
): Effect.Effect<Readonly<{ readonly hex: string; readonly sri: SriHash }>> {
  return Effect.promise(
    async (): Promise<Readonly<{ readonly hex: string; readonly sri: SriHash }>> => {
      const digest = new Uint8Array(
        await globalThis.crypto.subtle.digest("SHA-256", Uint8Array.from(bytes)),
      );
      const hex = Array.from(digest, (byte: number): string =>
        byte.toString(HEX_RADIX).padStart(2, "0"),
      ).join("");
      return {
        hex,
        sri: formatSriHash("sha256", [...digest]),
      };
    },
  );
}

function verifiedAsset(
  httpClient: Readonly<HttpClient>,
  asset: string,
  url: string,
  expected: string,
): Effect.Effect<SriHash, ChecksumVerificationError> {
  return Effect.flatMap(
    httpClient.request(httpRequest(url)),
    <Response extends HttpResponse>(
      response: Response,
    ): Effect.Effect<SriHash, ChecksumManifestError> & Readonly<{ readonly response?: Response }> =>
      Effect.flatMap(digestHex([...response.body]), ({ hex, sri }) =>
        hex === expected
          ? Effect.succeed(sri)
          : Effect.fail(
              new ChecksumManifestError(
                "mismatch",
                asset,
                `Checksum mismatch: ${asset}`,
                expected,
                hex,
              ),
            ),
      ),
  );
}

function verifiedAssetForExpected(
  httpClient: Readonly<HttpClient>,
  asset: string,
  url: string,
  expected: Readonly<Record<string, string>>,
): Effect.Effect<SriHash, ChecksumVerificationError> {
  const expectedHash = expected[asset];
  if (expectedHash === undefined) {
    return Effect.fail(new ChecksumManifestError("missing", asset, `Missing checksum: ${asset}`));
  }
  return verifiedAsset(httpClient, asset, url, expectedHash);
}

function verifiedAssets(
  httpClient: Readonly<HttpClient>,
  assetUrls: Readonly<Record<string, string>>,
  expected: Readonly<Record<string, string>>,
): Effect.Effect<ChecksumManifestResult, ChecksumVerificationError> {
  const assetEntries = Object.entries(assetUrls);
  const verificationEntries = assetEntries.map(
    (
      entry: readonly [string, string],
    ): readonly [string, Effect.Effect<SriHash, ChecksumVerificationError>] => {
      const [asset, assetUrl] = entry;
      return [asset, verifiedAssetForExpected(httpClient, asset, assetUrl, expected)];
    },
  );
  const verificationEffects = Object.fromEntries(verificationEntries);
  return Effect.all(verificationEffects, { concurrency: "unbounded" });
}

function verifiedManifestResponse<Response extends HttpResponse>(
  httpClient: Readonly<HttpClient>,
  assets: readonly string[],
  assetUrls: Readonly<Record<string, string>>,
  manifestResponse: Response,
): Effect.Effect<ChecksumManifestResult, ChecksumVerificationError> &
  Readonly<{ readonly response?: Response }> {
  const manifestEffect = responseText(manifestResponse);
  return manifestEffect.pipe(
    Effect.flatMap((manifest: string) => {
      const expectedEffect = parseChecksumManifest(manifest, assets);
      return expectedEffect.pipe(
        Effect.flatMap((expected) => verifiedAssets(httpClient, assetUrls, expected)),
      );
    }),
  );
}

function verifiedChecksumAssets(
  httpClient: Readonly<HttpClient>,
  manifestUrl: string,
  assetUrls: Readonly<Record<string, string>>,
): Effect.Effect<ChecksumManifestResult, ChecksumVerificationError> {
  const assets = Object.keys(assetUrls);
  const manifestEffect = httpClient.request(httpRequest(manifestUrl));
  return manifestEffect.pipe(
    Effect.flatMap(
      <Response extends HttpResponse>(
        manifestResponse: Response,
      ): Effect.Effect<ChecksumManifestResult, ChecksumVerificationError> &
        Readonly<{ readonly response?: Response }> =>
        verifiedManifestResponse(httpClient, assets, assetUrls, manifestResponse),
    ),
  );
}

function writeVerifiedPackageHashConfig(
  pinFilePath: string,
  version: string,
  assets: Readonly<Record<SupportedSystem, string>>,
  hashes: ChecksumManifestResult,
): Effect.Effect<void, UpdateError> {
  const hashEffects = systemRecord(
    (system: SupportedSystem): Effect.Effect<SriHash, UpdateError> => {
      const asset = assets[system];
      const hash = hashes[asset];
      return hash === undefined
        ? Effect.fail(new UpdateError(`Missing verified checksum: ${asset}`))
        : Effect.succeed(hash);
    },
  );
  const platformPackageHashesEffect = Effect.all(hashEffects);
  return platformPackageHashesEffect.pipe(
    Effect.flatMap((platformPackageHashes) =>
      writePackageHashConfig(pinFilePath, { platformPackageHashes, version }),
    ),
  );
}

function checksumManifestUpdateProgram<LatestVersionError extends Error>(
  options: ChecksumManifestUpdateOptions<LatestVersionError>,
): Effect.Effect<void, ChecksumVerificationError | LatestVersionError | UpdateError> {
  const assets = Object.values(options.assets);
  return updateNewerPinVersion(
    options.args,
    options.latestVersion,
    options.pinFilePath,
    (version: string): Effect.Effect<void, ChecksumVerificationError | UpdateError> => {
      const assetEntries = assets.map((asset: string): readonly [string, string] => [
        asset,
        options.assetUrl(version, asset),
      ]);
      const assetUrls = Object.fromEntries(assetEntries);
      const verified = verifiedChecksumAssets(
        options.httpClient,
        options.manifestUrl(version),
        assetUrls,
      );
      return verified.pipe(
        Effect.flatMap((hashes: ChecksumManifestResult) =>
          writeVerifiedPackageHashConfig(options.pinFilePath, version, options.assets, hashes),
        ),
      );
    },
    options.versionScheme,
  );
}

export {
  ChecksumManifestError,
  checksumManifestUpdateProgram,
  parseChecksumManifest,
  verifiedChecksumAssets,
};
export type { ChecksumManifestErrorKind, ChecksumManifestResult, ChecksumVerificationError };
