import type { HttpRequest, HttpResponse, JsonResponse } from "coolheaded/core/httpClient.ts";
import { assertEquals, assertStrictEquals } from "@jsr/std__assert";
import { main, updateProgram } from "coolheadedPackage/deno/update.ts";
import { strictHttpClient, strictJsonClient } from "coolheadedTestSupport/httpClient.ts";
import { Effect } from "effect";
import { FakeCommandRunner } from "coolheadedTestSupport/commandRunner.ts";
import { httpStatusError } from "coolheaded/core/fetchHttpClient.ts";

const VERSION = "1.0.1";
const SYSTEM = "aarch64-darwin";
const COMMAND_OK = { code: 0, stderr: "", stdout: "" };
const HTTP_OK = 200;
const SERVICE_UNAVAILABLE_STATUS = 503;
const REQUEST_TIMEOUT_MS = 30_000;
const GITHUB_URL = "https://api.github.com/repos/denoland/deno/tags?per_page=100";
const PIN_SENTINEL = new globalThis.TextEncoder().encode('{ "version": "1.0.0" }\n');
const ORIGINAL_HASH = "sha256-AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=";
const UPDATED_HASH = "sha256-AgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgI=";
const PLATFORM_HASHES = [
  {
    hex: "0".repeat(64),
    sri: "sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
    target: "aarch64-apple-darwin",
  },
  {
    hex: "01".repeat(32),
    sri: ORIGINAL_HASH,
    target: "aarch64-unknown-linux-gnu",
  },
  {
    hex: "02".repeat(32),
    sri: UPDATED_HASH,
    target: "x86_64-unknown-linux-gnu",
  },
] as const;

function request(url: string): HttpRequest {
  return { headers: {}, method: "GET", timeoutMs: REQUEST_TIMEOUT_MS, url };
}

function response(url: string, body: string): HttpResponse {
  return {
    body: new globalThis.TextEncoder().encode(body),
    headers: {},
    status: HTTP_OK,
    statusText: "OK",
    url,
  };
}

Deno.test("Deno update writes release hashes and isolated snapshot hash", async (): Promise<void> => {
  const directory = await Deno.makeTempDir();
  const pinFilePath = `${directory}/pin.json`;
  const snapshotFilePath = `${directory}/denoDependencies.nix`;
  await Deno.writeTextFile(pinFilePath, '{ "version": "1.0.0" }\n');
  await Deno.writeTextFile(snapshotFilePath, `{ hash = "${ORIGINAL_HASH}"; }\n`);
  const json = strictJsonClient([
    {
      effect: (): Effect.Effect<JsonResponse> =>
        Effect.succeed({
          response: response(GITHUB_URL, `[{"name":"v${VERSION}"}]`),
          value: [{ name: `v${VERSION}` }],
        }),
      request: {
        headers: { accept: "application/vnd.github+json" },
        method: "GET",
        timeoutMs: REQUEST_TIMEOUT_MS,
        url: GITHUB_URL,
      },
    },
  ]);
  const http = strictHttpClient(
    PLATFORM_HASHES.map(({ hex, target }) => {
      const url = `https://dl.deno.land/release/v${VERSION}/deno-${target}.zip.sha256sum`;
      return {
        effect: (): Effect.Effect<HttpResponse> =>
          Effect.succeed(response(url, `${hex}  deno-${target}.zip\n`)),
        request: request(url),
      };
    }),
  );
  const snapshotResult = {
    code: 1,
    stderr: `coolheaded-deno-dependencies\nerror: got: ${UPDATED_HASH}\n`,
    stdout: "",
  };
  const runner = new FakeCommandRunner([
    {
      request: {
        command: ["nix", "eval", "--impure", "--raw", "--expr", "builtins.currentSystem"],
      },
      result: { ...COMMAND_OK, stdout: `${SYSTEM}\n` },
    },
    {
      request: {
        command: [
          "nix",
          "build",
          `.#checks.${SYSTEM}.denoDependencies`,
          "--no-link",
          "--print-build-logs",
        ],
      },
      result: snapshotResult,
    },
  ]);
  try {
    await main([], {
      denoSnapshotFilePath: snapshotFilePath,
      httpClient: http.client,
      jsonClient: json.client,
      pinFilePath,
      runner,
    });
    assertEquals(
      await Deno.readTextFile(pinFilePath),
      `{\n  "version": "${VERSION}",\n  "platformPackageHashes": {\n    "aarch64-darwin": "${PLATFORM_HASHES[0].sri}",\n    "aarch64-linux": "${PLATFORM_HASHES[1].sri}",\n    "x86_64-linux": "${PLATFORM_HASHES[2].sri}"\n  }\n}\n`,
    );
    assertEquals(await Deno.readTextFile(snapshotFilePath), `{ hash = "${UPDATED_HASH}"; }\n`);
    assertStrictEquals(runner.observations()[1]?.result, snapshotResult);
    runner.assertExhausted();
    json.assertExhausted();
    http.assertExhausted();
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("Deno update preserves release HTTP error before snapshot work", async (): Promise<void> => {
  const directory = await Deno.makeTempDir();
  const pinFilePath = `${directory}/pin.json`;
  const snapshotFilePath = `${directory}/denoDependencies.nix`;
  await Deno.writeFile(pinFilePath, PIN_SENTINEL);
  const snapshotSentinel = `{ hash = "${ORIGINAL_HASH}"; }\n`;
  await Deno.writeTextFile(snapshotFilePath, snapshotSentinel);
  const json = strictJsonClient([
    {
      effect: (): Effect.Effect<JsonResponse> =>
        Effect.succeed({
          response: response(GITHUB_URL, `[{"name":"v${VERSION}"}]`),
          value: [{ name: `v${VERSION}` }],
        }),
      request: {
        headers: { accept: "application/vnd.github+json" },
        method: "GET",
        timeoutMs: REQUEST_TIMEOUT_MS,
        url: GITHUB_URL,
      },
    },
  ]);
  const baseUrl = "https://dl.deno.land/release/v1.0.1";
  const failingUrl = `${baseUrl}/deno-aarch64-apple-darwin.zip.sha256sum`;
  const failingRequest = request(failingUrl);
  const error = httpStatusError(failingRequest, {
    ...response(failingUrl, ""),
    status: SERVICE_UNAVAILABLE_STATUS,
    statusText: "Service Unavailable",
  });
  const http = strictHttpClient([
    {
      effect: (): Effect.Effect<never, typeof error> => Effect.fail(error),
      request: failingRequest,
    },
    {
      effect: (): Effect.Effect<HttpResponse> =>
        Effect.succeed(
          response(
            `${baseUrl}/deno-aarch64-unknown-linux-gnu.zip.sha256sum`,
            PLATFORM_HASHES[1].hex,
          ),
        ),
      request: request(`${baseUrl}/deno-aarch64-unknown-linux-gnu.zip.sha256sum`),
    },
    {
      effect: (): Effect.Effect<HttpResponse> =>
        Effect.succeed(
          response(
            `${baseUrl}/deno-x86_64-unknown-linux-gnu.zip.sha256sum`,
            PLATFORM_HASHES[2].hex,
          ),
        ),
      request: request(`${baseUrl}/deno-x86_64-unknown-linux-gnu.zip.sha256sum`),
    },
  ]);
  const runner = new FakeCommandRunner([]);
  try {
    const failure = await Effect.runPromise(
      Effect.flip(
        updateProgram([], {
          denoSnapshotFilePath: snapshotFilePath,
          httpClient: http.client,
          jsonClient: json.client,
          pinFilePath,
          runner,
        }),
      ),
    );
    assertStrictEquals(failure, error);
    assertEquals(await Deno.readFile(pinFilePath), PIN_SENTINEL);
    assertEquals(await Deno.readTextFile(snapshotFilePath), snapshotSentinel);
    http.assertExhausted();
    json.assertExhausted();
    runner.assertExhausted();
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});
