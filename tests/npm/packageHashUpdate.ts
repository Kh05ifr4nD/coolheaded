import { assertEquals, assertInstanceOf } from "@jsr/std__assert";
import { describe, it } from "@jsr/std__testing/bdd";
import {
  npmPackageHashUpdateProgram,
  npmPlatformPackageHashUpdateProgram,
} from "coolheaded/npm/packageHash.ts";
import { Effect } from "effect";
import { InvalidPackageHashConfigError } from "coolheaded/pin/packageHashConfig.ts";
import type { JsonResponse } from "coolheaded/core/httpClient.ts";
import { strictJsonClient } from "coolheadedTestSupport/httpClient.ts";

const HTTP_OK = 200;
const REQUEST_TIMEOUT_MS = 30_000;
const REQUEST = {
  headers: {},
  method: "GET",
  timeoutMs: REQUEST_TIMEOUT_MS,
  url: "https://registry.npmjs.org/example",
} as const;
const SHA512_DARWIN =
  "sha512-AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQ==";
const SHA512_LINUX_ARM =
  "sha512-AgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg==";
const SHA512_LINUX_X64 =
  "sha512-AwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAw==";
const SHA512_PACKAGE =
  "sha512-BAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBA==";
const SUFFIXES = {
  "aarch64-darwin": "darwin-arm64",
  "aarch64-linux": "linux-arm64",
  "x86_64-linux": "linux-x64",
} as const;

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

async function withPinFile(
  initial: string,
  operation: (pinFilePath: string) => Promise<void>,
): Promise<void> {
  const pinFilePath = await Deno.makeTempFile();
  await Deno.writeTextFile(pinFilePath, initial);
  try {
    await operation(pinFilePath);
  } finally {
    await Deno.remove(pinFilePath);
  }
}

describe("npm package hash updates", (): void => {
  it("leaves same-package pin unchanged after malformed integrity", async (): Promise<void> => {
    await withPinFile("sentinel", async (pinFilePath: string): Promise<void> => {
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
        Effect.flip(
          npmPackageHashUpdateProgram({
            args: ["1.0.0"],
            jsonClient: strict.client,
            packageName: "example",
            pinFilePath,
          }),
        ),
      );
      assertInstanceOf(error, InvalidPackageHashConfigError);
      assertEquals(await Deno.readTextFile(pinFilePath), "sentinel");
      strict.assertExhausted();
    });
  });

  it("leaves platform pin unchanged after malformed integrity", async (): Promise<void> => {
    await withPinFile("sentinel", async (pinFilePath: string): Promise<void> => {
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
          npmPlatformPackageHashUpdateProgram({
            args: ["1.0.0"],
            jsonClient: strict.client,
            packageName: "example",
            pinFilePath,
            suffixes: SUFFIXES,
          }),
        ),
      );
      assertInstanceOf(error, InvalidPackageHashConfigError);
      assertEquals(await Deno.readTextFile(pinFilePath), "sentinel");
      strict.assertExhausted();
    });
  });

  it("writes same-hash npm package pins", async (): Promise<void> => {
    await withPinFile("", async (pinFilePath: string): Promise<void> => {
      const strict = strictJsonClient([
        {
          effect: (): Effect.Effect<JsonResponse> =>
            Effect.succeed(
              metadata({
                versions: { "1.0.0": { dist: { integrity: SHA512_PACKAGE } } },
              }),
            ),
          request: REQUEST,
        },
      ]);
      await Effect.runPromise(
        npmPackageHashUpdateProgram({
          args: ["1.0.0"],
          jsonClient: strict.client,
          packageName: "example",
          pinFilePath,
        }),
      );
      assertEquals(JSON.parse(await Deno.readTextFile(pinFilePath)), {
        platformPackageHashes: {
          "aarch64-darwin": SHA512_PACKAGE,
          "aarch64-linux": SHA512_PACKAGE,
          "x86_64-linux": SHA512_PACKAGE,
        },
        version: "1.0.0",
      });
      strict.assertExhausted();
    });
  });

  it("writes platform npm package pins", async (): Promise<void> => {
    await withPinFile("", async (pinFilePath: string): Promise<void> => {
      const strict = strictJsonClient([
        {
          effect: (): Effect.Effect<JsonResponse> =>
            Effect.succeed(
              metadata({
                versions: {
                  "1.0.0-darwin-arm64": { dist: { integrity: SHA512_DARWIN } },
                  "1.0.0-linux-arm64": { dist: { integrity: SHA512_LINUX_ARM } },
                  "1.0.0-linux-x64": { dist: { integrity: SHA512_LINUX_X64 } },
                },
              }),
            ),
          request: REQUEST,
        },
      ]);
      await Effect.runPromise(
        npmPlatformPackageHashUpdateProgram({
          args: ["1.0.0"],
          jsonClient: strict.client,
          packageName: "example",
          pinFilePath,
          suffixes: SUFFIXES,
        }),
      );
      assertEquals(JSON.parse(await Deno.readTextFile(pinFilePath)), {
        platformPackageHashes: {
          "aarch64-darwin": SHA512_DARWIN,
          "aarch64-linux": SHA512_LINUX_ARM,
          "x86_64-linux": SHA512_LINUX_X64,
        },
        version: "1.0.0",
      });
      strict.assertExhausted();
    });
  });
});
