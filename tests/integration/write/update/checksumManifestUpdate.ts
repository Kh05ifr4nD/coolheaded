import type { HttpClient, HttpRequest, HttpResponse } from "coolheaded/core/httpClient.ts";
import { assertEquals, assertStrictEquals } from "@jsr/std__assert";
import { httpStatusError, httpTransportError } from "coolheaded/core/fetchHttpClient.ts";
import { Effect } from "effect";
import { checksumManifestUpdateProgram } from "coolheaded/update/checksumManifest.ts";
import { strictHttpClient } from "coolheadedTestSupport/httpClient.ts";

const VERSION = "1.2.3";
const REQUEST_TIMEOUT_MS = 30_000;
const OK_STATUS = 200;
const NON_UTF8_BYTE = 255;
const SERVICE_UNAVAILABLE_STATUS = 503;
const ASSETS = {
  "aarch64-darwin": "fictional-darwin.tar.gz",
  "aarch64-linux": "fictional-linux-arm64.tar.gz",
  "x86_64-linux": "fictional-linux-amd64.tar.gz",
} as const;
const MANIFEST_URL = "https://example.test/releases/v1.2.3/SHA256SUMS";
const ASSET_URLS = {
  darwin: "https://example.test/releases/v1.2.3/fictional-darwin.tar.gz",
  linuxArm: "https://example.test/releases/v1.2.3/fictional-linux-arm64.tar.gz",
  linuxX64: "https://example.test/releases/v1.2.3/fictional-linux-amd64.tar.gz",
} as const;
const EMPTY_HASH = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
const LINUX_ARM_HASH = "ef192b7af54e943f206ab27075ec1805384c972c9959fc5820f1fa7d5268fcef";
const LINUX_X64_HASH = "eb92afeaefa129c68e74e33f648f96e21b91b36d48bf64d3a1d72053b0cf44f8";
const EMPTY_SRI = "sha256-47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=";
const LINUX_ARM_SRI = "sha256-7xkrevVOlD8garJwdewYBThMlyyZWfxYIPH6fVJo/O8=";
const LINUX_X64_SRI = "sha256-65Kv6u+hKcaOdOM/ZI+W4huRs21Iv2TTodcgU7DPRPg=";
const PIN_SENTINEL = Uint8Array.from([NON_UTF8_BYTE, 0, 128]);

function request(url: string): HttpRequest {
  return { headers: {}, method: "GET", timeoutMs: REQUEST_TIMEOUT_MS, url };
}

function response(url: string, body: Readonly<Iterable<number>>, status = OK_STATUS): HttpResponse {
  const responseBody = Uint8Array.from(body);
  return {
    body: responseBody,
    headers: {},
    status,
    statusText: status === OK_STATUS ? "OK" : "Service Unavailable",
    url,
  };
}

function responseEffect(
  url: string,
  body: Readonly<Iterable<number>>,
  status = OK_STATUS,
): Effect.Effect<HttpResponse> {
  const httpResponse = response(url, body, status);
  return Effect.succeed(httpResponse);
}

function manifestBytes(): Uint8Array {
  const encoder = new globalThis.TextEncoder();
  return encoder.encode(
    `${EMPTY_HASH}  ${ASSETS["aarch64-darwin"]}\n` +
      `${LINUX_ARM_HASH}  ${ASSETS["aarch64-linux"]}\n` +
      `${LINUX_X64_HASH}  ${ASSETS["x86_64-linux"]}`,
  );
}

function program(
  pinFilePath: string,
  httpClient: Readonly<HttpClient>,
): ReturnType<typeof checksumManifestUpdateProgram> {
  return checksumManifestUpdateProgram({
    args: [VERSION],
    assetUrl: (version: string, asset: string): string => {
      assertEquals(version, VERSION);
      if (asset === ASSETS["aarch64-darwin"]) {
        return ASSET_URLS.darwin;
      }
      if (asset === ASSETS["aarch64-linux"]) {
        return ASSET_URLS.linuxArm;
      }
      return ASSET_URLS.linuxX64;
    },
    assets: ASSETS,
    httpClient,
    latestVersion: (): Effect.Effect<string> => Effect.succeed(VERSION),
    manifestUrl: (version: string): string => {
      assertEquals(version, VERSION);
      return MANIFEST_URL;
    },
    pinFilePath,
  });
}

async function withPin(
  initial: Readonly<Iterable<number>>,
  operation: (pinFilePath: string) => Promise<void>,
): Promise<void> {
  const pinFilePath = await Deno.makeTempFile();
  const initialBytes = Uint8Array.from(initial);
  await Deno.writeFile(pinFilePath, initialBytes);
  try {
    await operation(pinFilePath);
  } finally {
    await Deno.remove(pinFilePath);
  }
}

Deno.test("checksum manifest update writes fictional assets into a package hash pin", async (): Promise<void> => {
  const encoder = new globalThis.TextEncoder();
  const initial = encoder.encode('{"version":"0.0.0"}\n');
  await withPin(initial, async (pinFilePath: string): Promise<void> => {
    const manifestBody = [...manifestBytes()];
    const assetThreeBody = [...encoder.encode("asset-three")];
    const http = strictHttpClient([
      {
        effect: (): Effect.Effect<HttpResponse> => responseEffect(MANIFEST_URL, manifestBody),
        request: request(MANIFEST_URL),
      },
      {
        effect: (): Effect.Effect<HttpResponse> => responseEffect(ASSET_URLS.darwin, []),
        request: request(ASSET_URLS.darwin),
      },
      {
        effect: (): Effect.Effect<HttpResponse> =>
          responseEffect(ASSET_URLS.linuxArm, [NON_UTF8_BYTE, 0, 128]),
        request: request(ASSET_URLS.linuxArm),
      },
      {
        effect: (): Effect.Effect<HttpResponse> =>
          responseEffect(ASSET_URLS.linuxX64, assetThreeBody),
        request: request(ASSET_URLS.linuxX64),
      },
    ]);
    const update = program(pinFilePath, http.client);
    await Effect.runPromise(update);
    const pinText = await Deno.readTextFile(pinFilePath);
    const pin: unknown = JSON.parse(pinText);
    assertEquals(pin, {
      platformPackageHashes: {
        "aarch64-darwin": EMPTY_SRI,
        "aarch64-linux": LINUX_ARM_SRI,
        "x86_64-linux": LINUX_X64_SRI,
      },
      version: VERSION,
    });
    http.assertExhausted();
  });
});

Deno.test("checksum manifest update preserves pin after HTTP status failure", async (): Promise<void> => {
  await withPin(PIN_SENTINEL, async (pinFilePath: string): Promise<void> => {
    const manifestRequest = request(MANIFEST_URL);
    const failedResponse = response(MANIFEST_URL, [], SERVICE_UNAVAILABLE_STATUS);
    const error = httpStatusError(manifestRequest, failedResponse);
    const http = strictHttpClient([
      {
        effect: (): Effect.Effect<never, typeof error> => Effect.fail(error),
        request: manifestRequest,
      },
    ]);
    const update = program(pinFilePath, http.client);
    const failureEffect = Effect.flip(update);
    const failure = await Effect.runPromise(failureEffect);
    assertStrictEquals(failure, error);
    const pin = await Deno.readFile(pinFilePath);
    assertEquals(pin, PIN_SENTINEL);
    http.assertExhausted();
  });
});

Deno.test("checksum manifest update preserves pin after HTTP transport failure", async (): Promise<void> => {
  await withPin(PIN_SENTINEL, async (pinFilePath: string): Promise<void> => {
    const manifestRequest = request(MANIFEST_URL);
    const cause = new Error("network unavailable");
    const error = httpTransportError(manifestRequest, cause);
    const http = strictHttpClient([
      {
        effect: (): Effect.Effect<never, typeof error> => Effect.fail(error),
        request: manifestRequest,
      },
    ]);
    const update = program(pinFilePath, http.client);
    const failureEffect = Effect.flip(update);
    const failure = await Effect.runPromise(failureEffect);
    assertStrictEquals(failure, error);
    const pin = await Deno.readFile(pinFilePath);
    assertEquals(pin, PIN_SENTINEL);
    http.assertExhausted();
  });
});
