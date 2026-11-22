import {
  ChecksumManifestError,
  checksumManifestUpdateProgram,
} from "coolheaded/update/checksumManifest.ts";
import type { HttpRequest, HttpResponse } from "coolheaded/core/httpClient.ts";
import { assertEquals, assertInstanceOf } from "@jsr/std__assert";
import {
  releaseHashConfig,
  releaseHashUpdateProgram,
  releaseUrlsFromTargets,
} from "coolheaded/update/release.ts";
import { Effect } from "effect";
import { InvalidPackageHashConfigError } from "coolheaded/pin/packageHashConfig.ts";
import { strictHttpClient } from "coolheadedTestSupport/httpClient.ts";

const VERSION = "1.0.0";
const HTTP_OK = 200;
const REQUEST_TIMEOUT_MS = 30_000;
const EMPTY_HEX = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
const EMPTY_SRI = "sha256-47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=";
const MANIFEST_URL = "https://example.test/SHA256SUMS";
const INITIAL_PIN = '{"version":"0.0.0"}\n';
const DECLARATIONS = [
  { "aarch64-darwin": "darwin.tar.gz" },
  { "aarch64-linux": "linux-arm.tar.gz", "x86_64-linux": "linux-x64.tar.gz" },
] as const;

function plan(
  url: string,
  body: readonly number[],
): Parameters<typeof strictHttpClient>[0][number] {
  const request: HttpRequest = { headers: {}, method: "GET", timeoutMs: REQUEST_TIMEOUT_MS, url };
  const response: HttpResponse = {
    body: Uint8Array.from(body),
    headers: {},
    status: HTTP_OK,
    statusText: "OK",
    url,
  };
  return { effect: () => Effect.succeed(response), request };
}

async function withPin(operation: (path: string) => Promise<void>): Promise<void> {
  const path = await Deno.makeTempFile();
  try {
    await Deno.writeTextFile(path, INITIAL_PIN);
    await operation(path);
  } finally {
    await Deno.remove(path);
  }
}

for (const declaration of DECLARATIONS) {
  const systems = Object.keys(declaration);
  const platformPackageHashes = Object.fromEntries(systems.map((system) => [system, EMPTY_SRI]));
  const expectedPin = { platformPackageHashes, version: VERSION };

  Deno.test(`release update requests only declared platforms: ${systems.join(", ")}`, async () => {
    const urls = releaseUrlsFromTargets(declaration, (asset) => `https://example.test/${asset}`);
    assertEquals(Object.keys(urls), systems);
    const http = strictHttpClient(Object.values(urls).map((url) => plan(url, [])));
    await withPin(async (pinFilePath) => {
      await Effect.runPromise(
        releaseHashUpdateProgram({
          args: [VERSION],
          httpClient: http.client,
          latestVersion: () => Effect.succeed(VERSION),
          pinFilePath,
          source: "sha256Digest",
          urlsForVersion: () => urls,
        }),
      );
      const pin: unknown = JSON.parse(await Deno.readTextFile(pinFilePath));
      assertEquals(pin, expectedPin);
      http.assertExhausted();
    });
  });

  Deno.test(`manifest update requests only declared platforms: ${systems.join(", ")}`, async () => {
    const manifest = Object.values(declaration)
      .map((asset) => `${EMPTY_HEX}  ${asset}`)
      .join("\n");
    const http = strictHttpClient([
      plan(MANIFEST_URL, [...new globalThis.TextEncoder().encode(manifest)]),
      ...Object.values(declaration).map((asset) => plan(`https://example.test/${asset}`, [])),
    ]);
    await withPin(async (pinFilePath) => {
      await Effect.runPromise(
        checksumManifestUpdateProgram({
          args: [VERSION],
          assetUrl: (_version, asset) => `https://example.test/${asset}`,
          assets: declaration,
          httpClient: http.client,
          latestVersion: () => Effect.succeed(VERSION),
          manifestUrl: () => MANIFEST_URL,
          pinFilePath,
        }),
      );
      const pin: unknown = JSON.parse(await Deno.readTextFile(pinFilePath));
      assertEquals(pin, expectedPin);
      http.assertExhausted();
    });
  });
}

Deno.test("release hash configuration rejects an empty platform declaration", async () => {
  const http = strictHttpClient([]);
  const error = await Effect.runPromise(
    Effect.flip(releaseHashConfig(VERSION, {}, "sha256Digest", http.client)),
  );
  assertInstanceOf(error, InvalidPackageHashConfigError);
  http.assertExhausted();
});

Deno.test("manifest update preserves pin for an empty platform declaration", async () => {
  const http = strictHttpClient([plan(MANIFEST_URL, [])]);
  await withPin(async (pinFilePath) => {
    const error = await Effect.runPromise(
      Effect.flip(
        checksumManifestUpdateProgram({
          args: [VERSION],
          assetUrl: (_version, asset) => `https://example.test/${asset}`,
          assets: {},
          httpClient: http.client,
          latestVersion: () => Effect.succeed(VERSION),
          manifestUrl: () => MANIFEST_URL,
          pinFilePath,
        }),
      ),
    );
    assertInstanceOf(error, InvalidPackageHashConfigError);
    assertEquals(await Deno.readTextFile(pinFilePath), INITIAL_PIN);
    http.assertExhausted();
  });
});

Deno.test("sparse manifest update preserves pin when declared asset is missing", async () => {
  const manifest = `${EMPTY_HEX}  unrelated.tar.gz`;
  const http = strictHttpClient([
    plan(MANIFEST_URL, [...new globalThis.TextEncoder().encode(manifest)]),
  ]);
  await withPin(async (pinFilePath) => {
    const error = await Effect.runPromise(
      Effect.flip(
        checksumManifestUpdateProgram({
          args: [VERSION],
          assetUrl: (_version, asset) => `https://example.test/${asset}`,
          assets: { "aarch64-darwin": "darwin.tar.gz" },
          httpClient: http.client,
          latestVersion: () => Effect.succeed(VERSION),
          manifestUrl: () => MANIFEST_URL,
          pinFilePath,
        }),
      ),
    );
    assertInstanceOf(error, ChecksumManifestError);
    assertEquals(
      { asset: error.asset, kind: error.kind },
      { asset: "darwin.tar.gz", kind: "missing" },
    );
    assertEquals(await Deno.readTextFile(pinFilePath), INITIAL_PIN);
    http.assertExhausted();
  });
});
