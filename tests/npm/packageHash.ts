import { describe, it } from "@jsr/std__testing/bdd";
import { npmPackageHashConfig, npmPlatformPackageHashConfig } from "coolheaded/npm/packageHash.ts";
import { Effect } from "effect";
import { InvalidPackageHashConfigError } from "coolheaded/pin/packageHashConfig.ts";
import type { JsonResponse } from "coolheaded/core/httpClient.ts";
import { assertInstanceOf } from "@jsr/std__assert";
import { strictJsonClient } from "coolheadedTestSupport/httpClient.ts";

const HTTP_OK = 200;
const REQUEST_TIMEOUT_MS = 30_000;
const REQUEST = {
  headers: {},
  method: "GET",
  timeoutMs: REQUEST_TIMEOUT_MS,
  url: "https://registry.npmjs.org/example",
} as const;
const SHA512_LINUX_ARM =
  "sha512-AgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg==";
const SHA512_LINUX_X64 =
  "sha512-AwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAw==";

function metadata(value: unknown): JsonResponse {
  return {
    response: {
      body: new Uint8Array(),
      headers: {},
      status: HTTP_OK,
      statusText: "OK",
      url: REQUEST.url,
    },
    value,
  };
}

describe("npm package hash boundaries", (): void => {
  it("fails malformed same-package integrity as typed config error", async (): Promise<void> => {
    const strict = strictJsonClient([
      {
        effect: (): Effect.Effect<JsonResponse> =>
          Effect.succeed(
            metadata({
              versions: { "1.0.0": { dist: { integrity: "sha512-invalid" } } },
            }),
          ),
        request: REQUEST,
      },
    ]);
    const error = await Effect.runPromise(
      Effect.flip(npmPackageHashConfig("example", "1.0.0", strict.client)),
    );
    assertInstanceOf(error, InvalidPackageHashConfigError);
    strict.assertExhausted();
  });

  it("fails malformed platform integrity through package boundary", async (): Promise<void> => {
    const strict = strictJsonClient([
      {
        effect: (): Effect.Effect<JsonResponse> =>
          Effect.succeed(
            metadata({
              versions: {
                "1.0.0-darwin-arm64": { dist: { integrity: "sha512-invalid" } },
                "1.0.0-linux-arm64": { dist: { integrity: SHA512_LINUX_ARM } },
                "1.0.0-linux-x64": { dist: { integrity: SHA512_LINUX_X64 } },
              },
            }),
          ),
        request: REQUEST,
      },
    ]);
    const error = await Effect.runPromise(
      Effect.flip(
        npmPlatformPackageHashConfig(
          "example",
          "1.0.0",
          {
            "aarch64-darwin": "darwin-arm64",
            "aarch64-linux": "linux-arm64",
            "x86_64-linux": "linux-x64",
          },
          strict.client,
        ),
      ),
    );
    assertInstanceOf(error, InvalidPackageHashConfigError);
    strict.assertExhausted();
  });
});
