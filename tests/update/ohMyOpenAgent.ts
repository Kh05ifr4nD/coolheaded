import type { HttpRequest, JsonResponse } from "coolheaded/core/httpClient.ts";
import { assertEquals, assertInstanceOf } from "@jsr/std__assert";
import { Effect } from "effect";
import { InvalidNpmMetadataError } from "coolheaded/npm/registry.ts";
import { strictJsonClient } from "coolheadedTestSupport/httpClient.ts";
import { updateProgram } from "coolheadedPackageOhMyOpenAgent";

const HTTP_OK = 200;
const REQUEST_TIMEOUT_MS = 30_000;
const SENTINEL_BYTE = 255;
const VERSION = "1.2.3";
const INTEGRITY =
  "sha512-AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQ==";
const PACKAGE_NAMES = [
  "oh-my-openagent",
  "oh-my-openagent-darwin-arm64",
  "oh-my-openagent-linux-arm64",
  "oh-my-openagent-linux-x64",
] as const;

function request(packageName: string): HttpRequest {
  return {
    headers: {},
    method: "GET",
    timeoutMs: REQUEST_TIMEOUT_MS,
    url: `https://registry.npmjs.org/${packageName}`,
  };
}

function metadata(packageName: string, integrity: string | undefined): JsonResponse {
  const { url } = request(packageName);
  return {
    response: {
      body: new Uint8Array(),
      headers: {},
      status: HTTP_OK,
      statusText: "OK",
      url,
    },
    value: {
      versions: {
        [VERSION]: { dist: integrity === undefined ? {} : { integrity } },
      },
    },
  };
}

Deno.test("oh-my-openAgent update aggregates root and platform npm hashes", async (): Promise<void> => {
  const pinFilePath = await Deno.makeTempFile();
  const strict = strictJsonClient(
    PACKAGE_NAMES.map((packageName) => ({
      effect: (): Effect.Effect<JsonResponse> => Effect.succeed(metadata(packageName, INTEGRITY)),
      request: request(packageName),
    })),
  );
  try {
    await Effect.runPromise(updateProgram([VERSION], { jsonClient: strict.client, pinFilePath }));
    assertEquals(
      await Deno.readTextFile(pinFilePath),
      `{\n  "version": "${VERSION}",\n  "packageHash": "${INTEGRITY}",\n  "platformPackageHashes": {\n    "aarch64-darwin": "${INTEGRITY}",\n    "aarch64-linux": "${INTEGRITY}",\n    "x86_64-linux": "${INTEGRITY}"\n  }\n}\n`,
    );
    strict.assertExhausted();
  } finally {
    await Deno.remove(pinFilePath);
  }
});

Deno.test("oh-my-openAgent update preserves pin bytes after root metadata failure", async (): Promise<void> => {
  const pinFilePath = await Deno.makeTempFile();
  const sentinel = new Uint8Array([0, SENTINEL_BYTE, 1]);
  await Deno.writeFile(pinFilePath, sentinel);
  const strict = strictJsonClient(
    PACKAGE_NAMES.map((packageName, index) => ({
      effect: (): Effect.Effect<JsonResponse> =>
        Effect.succeed(metadata(packageName, index === 0 ? undefined : INTEGRITY)),
      request: request(packageName),
    })),
  );
  try {
    const error = await Effect.runPromise(
      Effect.flip(updateProgram([VERSION], { jsonClient: strict.client, pinFilePath })),
    );
    assertInstanceOf(error, InvalidNpmMetadataError);
    assertEquals(await Deno.readFile(pinFilePath), sentinel);
    strict.assertExhausted();
  } finally {
    await Deno.remove(pinFilePath);
  }
});
