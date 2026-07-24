import type {
  HttpClient,
  HttpClientError,
  HttpRequest,
  HttpResponse,
} from "coolheaded/core/httpClient.ts";
import { Effect } from "effect";
import { formatSriHash } from "coolheaded/pin/sriHash.ts";

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

function verifiedChecksumAssets(
  httpClient: Readonly<HttpClient>,
  manifestUrl: string,
  assetUrls: Readonly<Record<string, string>>,
): Effect.Effect<ChecksumManifestResult, ChecksumVerificationError> {
  const assets = Object.keys(assetUrls);
  return Effect.flatMap(
    httpClient.request(httpRequest(manifestUrl)),
    <Response extends HttpResponse>(
      manifestResponse: Response,
    ): Effect.Effect<ChecksumManifestResult, ChecksumVerificationError> &
      Readonly<{ readonly response?: Response }> =>
      Effect.flatMap(responseText(manifestResponse), (manifest: string) =>
        Effect.flatMap(parseChecksumManifest(manifest, assets), (expected) =>
          Effect.all(
            Object.fromEntries(
              Object.entries(assetUrls).map(
                (
                  entry: readonly [string, string],
                ): readonly [string, Effect.Effect<SriHash, ChecksumVerificationError>] => {
                  const [asset, assetUrl] = entry;
                  const expectedHash = expected[asset];
                  return [
                    asset,
                    expectedHash === undefined
                      ? Effect.fail(
                          new ChecksumManifestError("missing", asset, `Missing checksum: ${asset}`),
                        )
                      : verifiedAsset(httpClient, asset, assetUrl, expectedHash),
                  ];
                },
              ),
            ),
            { concurrency: "unbounded" },
          ),
        ),
      ),
  );
}

export { ChecksumManifestError, parseChecksumManifest, verifiedChecksumAssets };
export type { ChecksumManifestErrorKind, ChecksumManifestResult, ChecksumVerificationError };
