import type {
  HttpClient,
  HttpClientError,
  HttpRequest,
  HttpResponse,
} from "coolheaded/core/httpClient.ts";
import { UpdateError, updateNewerPinVersion } from "coolheaded/core/updateScript.ts";
import { Effect } from "effect";
import { formatSriHash } from "coolheaded/pin/sriHash.ts";
import { parsePackageHashConfig } from "coolheaded/pin/packageHashConfig.ts";
import { systemRecord } from "coolheaded/system/target.ts";
import { writePackageHashConfig } from "coolheaded/pin/json.ts";

const HEX_BYTE_WIDTH = 2;
const HEX_RADIX = 16;
const REQUEST_TIMEOUT_MS = 30_000;

type ReleaseHashSource = "sha256Digest" | "sha256Sum";
type SriHash = ReturnType<typeof formatSriHash>;
type SupportedSystem = Parameters<Parameters<typeof systemRecord>[0]>[0];
type PackageHashConfig = ReturnType<typeof parsePackageHashConfig>;
type ReleaseTargets = Readonly<Record<SupportedSystem, string>>;
type ReleaseUrls = Readonly<Record<SupportedSystem, string>>;

interface ReleaseHashUpdateOptions<LatestVersionError extends Error> {
  readonly args: readonly string[];
  readonly httpClient: HttpClient;
  readonly latestVersion: () => Effect.Effect<string, LatestVersionError>;
  readonly pinFilePath: string;
  readonly source: ReleaseHashSource;
  readonly urlsForVersion: (version: string) => ReleaseUrls;
}

function httpRequest(url: string): HttpRequest {
  return { headers: {}, method: "GET", timeoutMs: REQUEST_TIMEOUT_MS, url };
}

function responseText<Response extends HttpResponse>(
  response: Response,
): Effect.Effect<string, UpdateError> & Readonly<{ readonly response?: Response }> {
  return Effect.try({
    catch: (): UpdateError => new UpdateError(`Invalid UTF-8 response from ${response.url}`),
    try: (): string => new globalThis.TextDecoder("utf8", { fatal: true }).decode(response.body),
  });
}

function fetchText(
  url: string,
  httpClient: Readonly<HttpClient>,
): Effect.Effect<string, HttpClientError | UpdateError> {
  return Effect.flatMap(httpClient.request(httpRequest(url)), responseText);
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

function bytesToSha256SRI(bytes: readonly number[]): SriHash {
  return formatSriHash("sha256", bytes);
}

function hexSha256ToSRI(hex: string): SriHash {
  return bytesToSha256SRI([...hexToBytes(hex)]);
}

function releaseUrlsFromTargets(
  targets: ReleaseTargets,
  urlForTarget: (target: string) => string,
): ReleaseUrls {
  return systemRecord((system: SupportedSystem): string => urlForTarget(targets[system]));
}

function fetchSha256SumHash(
  url: string,
  httpClient: Readonly<HttpClient>,
): Effect.Effect<SriHash, HttpClientError | UpdateError> {
  return Effect.flatMap(
    fetchText(url, httpClient),
    (text: string): Effect.Effect<SriHash, UpdateError> =>
      Effect.map(parseSha256Hex(text, url), hexSha256ToSRI),
  );
}

function fetchSha256DigestHash(
  url: string,
  httpClient: Readonly<HttpClient>,
): Effect.Effect<SriHash, HttpClientError> {
  return Effect.flatMap(
    httpClient.request(httpRequest(url)),
    <Response extends HttpResponse>(
      response: Response,
    ): Effect.Effect<SriHash> & Readonly<{ readonly response?: Response }> =>
      Effect.map(
        Effect.promise(
          async (): Promise<readonly number[]> => [
            ...new Uint8Array(
              await globalThis.crypto.subtle.digest("SHA-256", Uint8Array.from(response.body)),
            ),
          ],
        ),
        bytesToSha256SRI,
      ),
  );
}

function hashForUrl(
  source: ReleaseHashSource,
  url: string,
  httpClient: Readonly<HttpClient>,
): Effect.Effect<SriHash, HttpClientError | UpdateError> {
  switch (source) {
    case "sha256Digest": {
      return fetchSha256DigestHash(url, httpClient);
    }
    case "sha256Sum": {
      return fetchSha256SumHash(url, httpClient);
    }
    default: {
      return Effect.fail(new UpdateError("Unsupported release hash source"));
    }
  }
}

function releaseHashes(
  urls: ReleaseUrls,
  source: ReleaseHashSource,
  httpClient: Readonly<HttpClient>,
): Effect.Effect<Readonly<Record<SupportedSystem, SriHash>>, HttpClientError | UpdateError> {
  return Effect.all(
    systemRecord(
      (system: SupportedSystem): Effect.Effect<SriHash, HttpClientError | UpdateError> =>
        hashForUrl(source, urls[system], httpClient),
    ),
  );
}

function releaseHashConfig(
  version: string,
  urls: ReleaseUrls,
  source: ReleaseHashSource,
  httpClient: Readonly<HttpClient>,
): Effect.Effect<PackageHashConfig, HttpClientError | UpdateError> {
  return Effect.map(
    releaseHashes(urls, source, httpClient),
    (platformPackageHashes: Readonly<Record<SupportedSystem, SriHash>>): PackageHashConfig =>
      parsePackageHashConfig({ platformPackageHashes, version }),
  );
}

function releaseHashUpdateProgram<LatestVersionError extends Error>(
  options: ReleaseHashUpdateOptions<LatestVersionError>,
): Effect.Effect<void, HttpClientError | LatestVersionError | UpdateError> {
  return updateNewerPinVersion(
    options.args,
    options.latestVersion,
    options.pinFilePath,
    (version: string): Effect.Effect<void, HttpClientError | UpdateError> =>
      Effect.flatMap(
        releaseHashConfig(
          version,
          options.urlsForVersion(version),
          options.source,
          options.httpClient,
        ),
        (config): Effect.Effect<void> => writePackageHashConfig(options.pinFilePath, config),
      ),
  );
}

export { hexSha256ToSRI, releaseHashConfig, releaseHashUpdateProgram, releaseUrlsFromTargets };
export type { ReleaseHashSource, ReleaseTargets, ReleaseUrls };
