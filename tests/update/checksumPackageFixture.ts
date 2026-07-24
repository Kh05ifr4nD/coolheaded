import type { HttpRequest, HttpResponse } from "coolheaded/core/httpClient.ts";
import { assertEquals, assertInstanceOf, assertStrictEquals } from "@jsr/std__assert";
import { strictHttpClient, strictJsonClient } from "coolheadedTestSupport/httpClient.ts";
import { ChecksumManifestError } from "coolheaded/update/checksumManifest.ts";
import { Effect } from "effect";
import { updateProgram as updateCodeGraph } from "coolheadedPackageCodeGraph";
import { updateProgram as updateEntire } from "coolheadedPackageEntire";

const OK_STATUS = 200;
const TIMEOUT_MS = 30_000;
const VERSION = "9.9.9";
const EMPTY_HASH = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
const NON_UTF8_HASH = "ef192b7af54e943f206ab27075ec1805384c972c9959fc5820f1fa7d5268fcef";
const THIRD_HASH = "eb92afeaefa129c68e74e33f648f96e21b91b36d48bf64d3a1d72053b0cf44f8";
const WRONG_HASH = "a".repeat(64);
const NON_UTF8_BYTE = 255;
const FAILURE_SENTINEL = Uint8Array.from([NON_UTF8_BYTE, 0, 128]);
const ASSET_BODIES = [
  [],
  [NON_UTF8_BYTE, 0, 128],
  [...new globalThis.TextEncoder().encode("asset-three")],
] as const satisfies readonly [readonly number[], readonly number[], readonly number[]];
type ExpectedHttpRequest = Parameters<typeof strictHttpClient>[0][number];
type Bytes = Readonly<{ readonly [index: number]: number; readonly length: number }>;
type PackageProgram = typeof updateCodeGraph;
interface PackageFixture {
  readonly assets: readonly [string, string, string];
  readonly manifestUrl: string;
  readonly program: PackageProgram;
  readonly repo: string;
}
interface ExpectedChecksumError {
  readonly actual?: string;
  readonly asset: string;
  readonly expected?: string;
  readonly kind: string;
}
const PACKAGES = [
  {
    assets: [
      "codegraph-darwin-arm64.tar.gz",
      "codegraph-linux-arm64.tar.gz",
      "codegraph-linux-x64.tar.gz",
    ],
    manifestUrl: "https://github.com/colbymchenry/codegraph/releases/download/v9.9.9/SHA256SUMS",
    program: updateCodeGraph,
    repo: "codegraph",
  },
  {
    assets: [
      "entire_darwin_arm64.tar.gz",
      "entire_linux_arm64.tar.gz",
      "entire_linux_amd64.tar.gz",
    ],
    manifestUrl: "https://github.com/entireio/cli/releases/download/v9.9.9/checksums.txt",
    program: updateEntire,
    repo: "cli",
  },
] as const satisfies readonly PackageFixture[];
function request(url: string, headers: Readonly<Record<string, string>> = {}): HttpRequest {
  return { headers, method: "GET", timeoutMs: TIMEOUT_MS, url };
}
function response(url: string, body: readonly number[], status: number = OK_STATUS): HttpResponse {
  return {
    body: Uint8Array.from(body),
    headers: {},
    status,
    statusText: status === OK_STATUS ? "OK" : "Service Unavailable",
    url,
  };
}
function assetUrls(fixture: Readonly<PackageFixture>): readonly [string, string, string] {
  const base = fixture.manifestUrl.slice(0, fixture.manifestUrl.lastIndexOf("/"));
  return [
    `${base}/${fixture.assets[0]}`,
    `${base}/${fixture.assets[1]}`,
    `${base}/${fixture.assets[2]}`,
  ];
}
function manifest(
  fixture: Readonly<PackageFixture>,
  hashes: readonly [string, string, string] = [EMPTY_HASH, NON_UTF8_HASH, THIRD_HASH],
): Uint8Array {
  return new globalThis.TextEncoder().encode(
    fixture.assets
      .map((asset: string, index: number): string => `${hashes[index]}  ${asset}`)
      .join("\n"),
  );
}
function successPlan(url: string, body: readonly number[]): ExpectedHttpRequest {
  return {
    effect: (): Effect.Effect<HttpResponse> => Effect.succeed(response(url, body)),
    request: request(url),
  };
}
async function pinPath(bytes: Bytes): Promise<string> {
  const path = await Deno.makeTempFile();
  await Deno.writeFile(path, Uint8Array.from(bytes));
  return path;
}
async function runFailure(
  fixture: Readonly<PackageFixture>,
  plans: readonly ExpectedHttpRequest[],
  expected: Readonly<Error> | Readonly<ExpectedChecksumError>,
): Promise<void> {
  const path = await pinPath(FAILURE_SENTINEL);
  const http = strictHttpClient(plans);
  const json = strictJsonClient([]);
  try {
    const error = await Effect.runPromise(
      Effect.flip(
        fixture.program([VERSION], {
          httpClient: http.client,
          jsonClient: json.client,
          pinFilePath: path,
        }),
      ),
    );
    if ("kind" in expected) {
      assertInstanceOf(error, ChecksumManifestError);
      assertEquals(
        {
          actual: error.actual,
          asset: error.asset,
          expected: error.expected,
          kind: error.kind,
        },
        {
          actual: expected.actual,
          asset: expected.asset,
          expected: expected.expected,
          kind: expected.kind,
        },
      );
    } else {
      assertStrictEquals(error, expected);
    }
    assertEquals(await Deno.readFile(path), FAILURE_SENTINEL);
    http.assertExhausted();
    json.assertExhausted();
  } finally {
    await Deno.remove(path);
  }
}

export {
  ASSET_BODIES,
  EMPTY_HASH,
  FAILURE_SENTINEL,
  manifest,
  NON_UTF8_BYTE,
  NON_UTF8_HASH,
  PACKAGES,
  pinPath,
  request,
  response,
  runFailure,
  successPlan,
  THIRD_HASH,
  VERSION,
  WRONG_HASH,
  assetUrls,
};
export type { ExpectedHttpRequest, PackageFixture };
