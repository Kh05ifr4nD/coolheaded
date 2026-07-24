import type { HttpRequest, HttpResponse, JsonResponse } from "coolheaded/core/httpClient.ts";
import { assertEquals, assertInstanceOf } from "@jsr/std__assert";
import { strictHttpClient, strictJsonClient } from "coolheadedTestSupport/httpClient.ts";
import { Effect } from "effect";
import { UpdateError } from "coolheaded/core/updateScript.ts";
import { updateProgram } from "coolheadedPackageOxfmt";

const HTTP_OK = 200;
const REQUEST_TIMEOUT_MS = 30_000;
const SENTINEL_BYTE = 255;
const VERSION = "1.2.3";
const BINARY_VERSION = "4.5.6";
const EMPTY_SRI = "sha256-47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=";
const RELEASE_URL = `https://api.github.com/repos/oxc-project/oxc/releases/tags/apps_v${VERSION}`;
const TARGETS = [
  "aarch64-apple-darwin",
  "aarch64-unknown-linux-gnu",
  "x86_64-unknown-linux-gnu",
] as const;

function httpRequest(url: string): HttpRequest {
  return { headers: {}, method: "GET", timeoutMs: REQUEST_TIMEOUT_MS, url };
}

function httpResponse(url: string): HttpResponse {
  return {
    body: new Uint8Array(),
    headers: {},
    status: HTTP_OK,
    statusText: "OK",
    url,
  };
}

function release(name: string): JsonResponse {
  return {
    response: httpResponse(RELEASE_URL),
    value: { name, tag_name: `apps_v${VERSION}` },
  };
}

function releaseRequest(): HttpRequest {
  return {
    headers: { accept: "application/vnd.github+json" },
    method: "GET",
    timeoutMs: REQUEST_TIMEOUT_MS,
    url: RELEASE_URL,
  };
}

Deno.test("oxfmt update extracts binary version and hashes every release asset", async (): Promise<void> => {
  const pinFilePath = await Deno.makeTempFile();
  const assetUrls = TARGETS.map(
    (target) =>
      `https://github.com/oxc-project/oxc/releases/download/apps_v${VERSION}/oxfmt-${target}.tar.gz`,
  );
  const json = strictJsonClient([
    {
      effect: (): Effect.Effect<JsonResponse> =>
        Effect.succeed(release(`Oxc release with oxfmt v${BINARY_VERSION}`)),
      request: releaseRequest(),
    },
  ]);
  const http = strictHttpClient(
    assetUrls.map((url) => ({
      effect: (): Effect.Effect<HttpResponse> => Effect.succeed(httpResponse(url)),
      request: httpRequest(url),
    })),
  );
  try {
    await Effect.runPromise(
      updateProgram([VERSION], {
        httpClient: http.client,
        jsonClient: json.client,
        pinFilePath,
      }),
    );
    assertEquals(
      await Deno.readTextFile(pinFilePath),
      `{\n  "version": "${VERSION}",\n  "binaryVersion": "${BINARY_VERSION}",\n  "platformPackageHashes": {\n    "aarch64-darwin": "${EMPTY_SRI}",\n    "aarch64-linux": "${EMPTY_SRI}",\n    "x86_64-linux": "${EMPTY_SRI}"\n  }\n}\n`,
    );
    http.assertExhausted();
    json.assertExhausted();
  } finally {
    await Deno.remove(pinFilePath);
  }
});

Deno.test("oxfmt update preserves pin bytes after malformed release title", async (): Promise<void> => {
  const pinFilePath = await Deno.makeTempFile();
  const sentinel = new Uint8Array([0, SENTINEL_BYTE, 1]);
  await Deno.writeFile(pinFilePath, sentinel);
  const json = strictJsonClient([
    {
      effect: (): Effect.Effect<JsonResponse> => Effect.succeed(release("Oxc release")),
      request: releaseRequest(),
    },
  ]);
  const http = strictHttpClient([]);
  try {
    const error = await Effect.runPromise(
      Effect.flip(
        updateProgram([VERSION], {
          httpClient: http.client,
          jsonClient: json.client,
          pinFilePath,
        }),
      ),
    );
    assertInstanceOf(error, UpdateError);
    assertEquals(error.message, "Missing oxfmt binary version in release title: Oxc release");
    assertEquals(await Deno.readFile(pinFilePath), sentinel);
    assertEquals(http.calls, []);
    http.assertExhausted();
    json.assertExhausted();
  } finally {
    await Deno.remove(pinFilePath);
  }
});
