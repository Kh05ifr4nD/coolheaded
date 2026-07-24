import {
  ChecksumManifestError,
  parseChecksumManifest,
  verifiedChecksumAssets,
} from "coolheaded/update/checksumManifest.ts";
import type { HttpRequest, HttpResponse } from "coolheaded/core/httpClient.ts";
import { assertEquals, assertInstanceOf } from "@jsr/std__assert";
import { Effect } from "effect";
import { strictHttpClient } from "coolheadedTestSupport/httpClient.ts";

const OK_STATUS = 200;
const NON_UTF8_BYTE = 255;
const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const HASH_OTHER = "c".repeat(64);
const NON_UTF8_HASH = "ef192b7af54e943f206ab27075ec1805384c972c9959fc5820f1fa7d5268fcef";
const EMPTY_HASH = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
const THIRD_HASH = "eb92afeaefa129c68e74e33f648f96e21b91b36d48bf64d3a1d72053b0cf44f8";
const EMPTY_SRI = "sha256-47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=";
const NON_UTF8_SRI = "sha256-7xkrevVOlD8garJwdewYBThMlyyZWfxYIPH6fVJo/O8=";
const THIRD_SRI = "sha256-65Kv6u+hKcaOdOM/ZI+W4huRs21Iv2TTodcgU7DPRPg=";
const MANIFEST_URL = "https://example.com/checksums.txt";
const TIMEOUT_MS = 30_000;
const ASSET_URLS = {
  "empty.tar.gz": "https://example.com/empty.tar.gz",
  "non-utf8.tar.gz": "https://example.com/non-utf8.tar.gz",
  "third.tar.gz": "https://example.com/third.tar.gz",
};
type ExpectedHttpRequest = Parameters<typeof strictHttpClient>[0][number];

function request(url: string): HttpRequest {
  return { headers: {}, method: "GET", timeoutMs: TIMEOUT_MS, url };
}

function response(url: string, body: readonly number[]): HttpResponse {
  return { body: Uint8Array.from(body), headers: {}, status: OK_STATUS, statusText: "OK", url };
}

function plan(url: string, body: readonly number[]): ExpectedHttpRequest {
  return {
    effect: (): Effect.Effect<HttpResponse> => Effect.succeed(response(url, body)),
    request: request(url),
  };
}

function manifestBytes(thirdHash: string = THIRD_HASH): readonly number[] {
  return [
    ...new globalThis.TextEncoder().encode(
      [
        `${NON_UTF8_HASH}  non-utf8.tar.gz`,
        `${EMPTY_HASH} *empty.tar.gz`,
        `${thirdHash}  third.tar.gz`,
      ].join("\n"),
    ),
  ];
}

async function manifestFailure(
  manifest: string,
  assets: readonly string[],
): Promise<ChecksumManifestError> {
  const error = await Effect.runPromise(Effect.flip(parseChecksumManifest(manifest, assets)));
  assertInstanceOf(error, ChecksumManifestError);
  return error;
}

Deno.test("checksum manifest selects exact requested GNU entries", async (): Promise<void> => {
  const parsed = await Effect.runPromise(
    parseChecksumManifest(
      [
        `${HASH_OTHER}  unrelated.tar.gz`,
        `${HASH_A}  tool-linux.tar.gz`,
        `${HASH_B} *tool-darwin.tar.gz`,
      ].join("\n"),
      ["tool-linux.tar.gz", "tool-darwin.tar.gz"],
    ),
  );
  assertEquals(parsed, {
    "tool-darwin.tar.gz": HASH_B,
    "tool-linux.tar.gz": HASH_A,
  });
});

for (const [name, manifest, kind, asset] of [
  [
    "missing exact filename despite suffix collision",
    `${HASH_A}  prefix-tool.tar.gz`,
    "missing",
    "tool.tar.gz",
  ],
  [
    "duplicate requested filename",
    `${HASH_A}  tool.tar.gz\n${HASH_B} *tool.tar.gz`,
    "duplicate",
    "tool.tar.gz",
  ],
  ["uppercase digest", `${HASH_A.toUpperCase()}  tool.tar.gz`, "malformed", "manifest"],
  ["single-space separator", `${HASH_A} tool.tar.gz`, "malformed", "manifest"],
  ["tab separator", `${HASH_A}\ttool.tar.gz`, "malformed", "manifest"],
  ["empty filename", `${HASH_A}  `, "malformed", "manifest"],
] as const) {
  Deno.test(`checksum manifest rejects ${name}`, async (): Promise<void> => {
    const error = await manifestFailure(manifest, [asset === "manifest" ? "tool.tar.gz" : asset]);
    assertEquals(error.kind, kind);
    assertEquals(error.asset, asset);
  });
}

Deno.test("checksum verification hashes all raw asset bytes", async (): Promise<void> => {
  const fake = strictHttpClient([
    plan(MANIFEST_URL, manifestBytes()),
    plan(ASSET_URLS["empty.tar.gz"], []),
    plan(ASSET_URLS["non-utf8.tar.gz"], [NON_UTF8_BYTE, 0, 128]),
    plan(ASSET_URLS["third.tar.gz"], [...new globalThis.TextEncoder().encode("asset-three")]),
  ]);
  const hashes = await Effect.runPromise(
    verifiedChecksumAssets(fake.client, MANIFEST_URL, ASSET_URLS),
  );
  const stringHashes: Readonly<Record<string, string>> = hashes;
  assertEquals(stringHashes, {
    "empty.tar.gz": EMPTY_SRI,
    "non-utf8.tar.gz": NON_UTF8_SRI,
    "third.tar.gz": THIRD_SRI,
  });
  fake.assertExhausted();
});

Deno.test("checksum verification rejects exact content mismatch", async (): Promise<void> => {
  const fake = strictHttpClient([
    plan(MANIFEST_URL, manifestBytes(HASH_OTHER)),
    plan(ASSET_URLS["empty.tar.gz"], []),
    plan(ASSET_URLS["non-utf8.tar.gz"], [NON_UTF8_BYTE, 0, 128]),
    plan(ASSET_URLS["third.tar.gz"], [...new globalThis.TextEncoder().encode("asset-three")]),
  ]);
  const error = await Effect.runPromise(
    Effect.flip(verifiedChecksumAssets(fake.client, MANIFEST_URL, ASSET_URLS)),
  );
  assertInstanceOf(error, ChecksumManifestError);
  assertEquals(
    {
      actual: error.actual,
      asset: error.asset,
      expected: error.expected,
      kind: error.kind,
    },
    {
      actual: THIRD_HASH,
      asset: "third.tar.gz",
      expected: HASH_OTHER,
      kind: "mismatch",
    },
  );
  fake.assertExhausted();
});
