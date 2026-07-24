import {
  VersionSourceError,
  latestNpmVersion,
  latestPyPiVersion,
} from "coolheaded/source/version.ts";
import { assertEquals, assertInstanceOf } from "@jsr/std__assert";
import { describe, it } from "@jsr/std__testing/bdd";
import { Effect } from "effect";
import type { JsonResponse } from "coolheaded/core/httpClient.ts";
import { strictJsonClient } from "coolheadedTestSupport/httpClient.ts";

const HTTP_OK = 200;
const REQUEST_TIMEOUT_MS = 30_000;
const npmRequest = {
  headers: {},
  method: "GET",
  timeoutMs: REQUEST_TIMEOUT_MS,
  url: "https://registry.npmjs.org/%40scope%2Fexample",
} as const;
const pyPiRequest = {
  headers: {},
  method: "GET",
  timeoutMs: REQUEST_TIMEOUT_MS,
  url: "https://pypi.org/pypi/example/json",
} as const;

function jsonResponse(value: unknown, url: string): JsonResponse {
  return {
    response: {
      body: new Uint8Array(),
      headers: {},
      status: HTTP_OK,
      statusText: "OK",
      url,
    },
    value,
  };
}

describe("registry version sources", (): void => {
  it("reads strict npm and PyPI metadata shapes", async (): Promise<void> => {
    const npm = strictJsonClient([
      {
        effect: (): Effect.Effect<JsonResponse> =>
          Effect.succeed(jsonResponse({ "dist-tags": { latest: "1.2.3" } }, npmRequest.url)),
        request: npmRequest,
      },
    ]);
    const pyPi = strictJsonClient([
      {
        effect: (): Effect.Effect<JsonResponse> =>
          Effect.succeed(jsonResponse({ info: { version: "2.3.4" } }, pyPiRequest.url)),
        request: pyPiRequest,
      },
    ]);

    assertEquals(await Effect.runPromise(latestNpmVersion("@scope/example", npm.client)), "1.2.3");
    assertEquals(await Effect.runPromise(latestPyPiVersion("example", pyPi.client)), "2.3.4");
    npm.assertExhausted();
    pyPi.assertExhausted();
  });

  it("rejects malformed npm metadata and versions", async (): Promise<void> => {
    await Promise.all(
      [
        null,
        {},
        { "dist-tags": {} },
        { "dist-tags": { latest: 1 } },
        { "dist-tags": { latest: "01.0.0" } },
      ].map(async (value: unknown): Promise<void> => {
        const strict = strictJsonClient([
          {
            effect: (): Effect.Effect<JsonResponse> =>
              Effect.succeed(jsonResponse(value, npmRequest.url)),
            request: npmRequest,
          },
        ]);
        const error = await Effect.runPromise(
          Effect.flip(latestNpmVersion("@scope/example", strict.client)),
        );
        assertInstanceOf(error, VersionSourceError);
        assertEquals(error.url, npmRequest.url);
        strict.assertExhausted();
      }),
    );
  });

  it("rejects malformed PyPI metadata and versions", async (): Promise<void> => {
    await Promise.all(
      [null, {}, { info: {} }, { info: { version: 1 } }, { info: { version: "1.0.0-" } }].map(
        async (value: unknown): Promise<void> => {
          const strict = strictJsonClient([
            {
              effect: (): Effect.Effect<JsonResponse> =>
                Effect.succeed(jsonResponse(value, pyPiRequest.url)),
              request: pyPiRequest,
            },
          ]);
          const error = await Effect.runPromise(
            Effect.flip(latestPyPiVersion("example", strict.client)),
          );
          assertInstanceOf(error, VersionSourceError);
          assertEquals(error.url, pyPiRequest.url);
          strict.assertExhausted();
        },
      ),
    );
  });
});
