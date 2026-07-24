import type { HttpRequest, HttpResponse } from "coolheaded/core/httpClient.ts";
import { assertEquals, assertInstanceOf } from "@jsr/std__assert";
import { Effect } from "effect";
import { UpdateError } from "coolheaded/core/updateScript.ts";
import { strictHttpClient } from "coolheadedTestSupport/httpClient.ts";
import { updateProgram } from "coolheadedPackageGrokBuild";

const HTTP_OK = 200;
const REQUEST_TIMEOUT_MS = 30_000;
const VERSION = "1.2.3";
const STABLE_URL = "https://x.ai/cli/stable";
const EMPTY_SRI = "sha256-47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=";
const TARGETS = ["macos-aarch64", "linux-aarch64", "linux-x86_64"] as const;

function response(url: string, body: string): HttpResponse {
  return {
    body: new globalThis.TextEncoder().encode(body),
    headers: {},
    status: HTTP_OK,
    statusText: "OK",
    url,
  };
}

function request(url: string): HttpRequest {
  return { headers: {}, method: "GET", timeoutMs: REQUEST_TIMEOUT_MS, url };
}

Deno.test("Grok update validates stable version and hashes every release asset", async (): Promise<void> => {
  const pinFilePath = await Deno.makeTempFile();
  await Deno.writeTextFile(pinFilePath, '{\n  "version": "1.0.0"\n}\n');
  const assetUrls = TARGETS.map((target) => `https://x.ai/cli/grok-${VERSION}-${target}`);
  const strict = strictHttpClient([
    {
      effect: (): Effect.Effect<HttpResponse> =>
        Effect.succeed(response(STABLE_URL, `${VERSION}\n`)),
      request: request(STABLE_URL),
    },
    ...assetUrls.map((url) => ({
      effect: (): Effect.Effect<HttpResponse> => Effect.succeed(response(url, "")),
      request: request(url),
    })),
  ]);
  try {
    await Effect.runPromise(updateProgram([], { httpClient: strict.client, pinFilePath }));
    assertEquals(
      await Deno.readTextFile(pinFilePath),
      `{\n  "version": "${VERSION}",\n  "platformPackageHashes": {\n    "aarch64-darwin": "${EMPTY_SRI}",\n    "aarch64-linux": "${EMPTY_SRI}",\n    "x86_64-linux": "${EMPTY_SRI}"\n  }\n}\n`,
    );
    strict.assertExhausted();
  } finally {
    await Deno.remove(pinFilePath);
  }
});

Deno.test("Grok update preserves pin bytes after invalid stable response", async (): Promise<void> => {
  const pinFilePath = await Deno.makeTempFile();
  const sentinel = new globalThis.TextEncoder().encode('{\n  "version": "1.0.0"\n}\n  ');
  await Deno.writeFile(pinFilePath, sentinel);
  const strict = strictHttpClient([
    {
      effect: (): Effect.Effect<HttpResponse> => Effect.succeed(response(STABLE_URL, "not-semver")),
      request: request(STABLE_URL),
    },
  ]);
  try {
    const error = await Effect.runPromise(
      Effect.flip(updateProgram([], { httpClient: strict.client, pinFilePath })),
    );
    assertInstanceOf(error, UpdateError);
    assertEquals(await Deno.readFile(pinFilePath), sentinel);
    strict.assertExhausted();
  } finally {
    await Deno.remove(pinFilePath);
  }
});
