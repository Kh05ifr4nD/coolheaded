import type { HttpRequest, HttpResponse, JsonResponse } from "coolheaded/core/httpClient.ts";
import { assertEquals, assertStrictEquals } from "@jsr/std__assert";
import { httpJsonError, httpStatusError } from "coolheaded/core/fetchHttpClient.ts";
import { strictHttpClient, strictJsonClient } from "coolheadedTestSupport/httpClient.ts";
import { Effect } from "effect";
import { FakeCommandRunner } from "coolheadedTestSupport/commandRunner.ts";
import { updateProgram as updateDeno } from "coolheadedPackageDeno";
import { updateGitHubRustPackagePin } from "coolheaded/update/rustPackage.ts";
import { updateGitHubSourcePin } from "coolheaded/source/github.ts";
import { updateNpmTarballPackage } from "coolheaded/npm/tarball.ts";
import { updateVersionedUvLock } from "coolheaded/update/uvLock.ts";

const OK_STATUS = 200;
const NON_TEXT_BYTE = 255;
const SERVICE_UNAVAILABLE_STATUS = 503;
const TIMEOUT_MS = 30_000;
const SENTINEL = '{"version":"0.0.0","sentinel":"unchanged"}\n';

function request(url: string): HttpRequest {
  return { headers: {}, method: "GET", timeoutMs: TIMEOUT_MS, url };
}

function response(url: string): HttpResponse {
  return {
    body: new Uint8Array(),
    headers: {},
    status: OK_STATUS,
    statusText: "OK",
    url,
  };
}

function jsonFailure(url: string): Readonly<{
  readonly client: ReturnType<typeof strictJsonClient>;
  readonly error: ReturnType<typeof httpJsonError>;
}> {
  const expectedRequest = request(url);
  const expectedResponse = response(url);
  const error = httpJsonError(expectedRequest, expectedResponse, new SyntaxError("sentinel"));
  return {
    client: strictJsonClient([
      {
        effect: (): Effect.Effect<JsonResponse, typeof error> => Effect.fail(error),
        request: expectedRequest,
      },
    ]),
    error,
  };
}

async function tempPin(): Promise<Readonly<{ readonly directory: string; readonly path: string }>> {
  const directory = await Deno.makeTempDir();
  const path = `${directory}/pin.json`;
  await Deno.writeTextFile(path, SENTINEL);
  return { directory, path };
}

async function assertFailure(
  effect: () => Effect.Effect<void, Error>,
  error: Readonly<Error>,
  pinPath: string,
): Promise<void> {
  const before = await Deno.readFile(pinPath);
  const failure = Effect.flip(effect());
  assertStrictEquals(await Effect.runPromise(failure), error);
  assertEquals(await Deno.readFile(pinPath), before);
}

for (const [name, program] of [
  [
    "GitHub source",
    (
      pinFilePath: string,
      error: Readonly<Error>,
      runner: Readonly<FakeCommandRunner>,
    ): Effect.Effect<void, Error> =>
      updateGitHubSourcePin({
        args: [],
        latestVersion: (): Effect.Effect<string, Error> => Effect.fail(error),
        pinFilePath,
        repositoryRootPath: "/unused",
        runner,
        source: { owner: "example", repo: "tool", tag: (version: string): string => version },
      }),
  ],
  [
    "Rust package",
    (
      pinFilePath: string,
      error: Readonly<Error>,
      runner: Readonly<FakeCommandRunner>,
    ): Effect.Effect<void, Error> =>
      updateGitHubRustPackagePin({
        args: [],
        latestVersion: (): Effect.Effect<string, Error> => Effect.fail(error),
        package: {
          owner: "example",
          pname: "tool",
          repo: "tool",
          tag: (version: string): string => version,
        },
        pinFilePath,
        repositoryRootPath: "/unused",
        runner,
      }),
  ],
  [
    "UV lock",
    (
      pinFilePath: string,
      error: Readonly<Error>,
      runner: Readonly<FakeCommandRunner>,
    ): Effect.Effect<void, Error> =>
      updateVersionedUvLock({
        args: [],
        latestVersion: (): Effect.Effect<string, Error> => Effect.fail(error),
        pinFilePath,
        project: (version: string) => ({
          dependencies: [`tool==${version}`],
          pythonMinorVersion: "3.13",
        }),
        repositoryRootPath: "/unused",
        runner,
        uvLockFilePath: "/unused",
      }),
  ],
] as const) {
  Deno.test(`${name} composite preserves injected HTTP error identity`, async (): Promise<void> => {
    const pin = await tempPin();
    const runner = new FakeCommandRunner([]);
    const error = httpJsonError(
      request("https://example.com"),
      response("https://example.com"),
      new Error("sentinel"),
    );
    try {
      await assertFailure(
        (): Effect.Effect<void, Error> => program(pin.path, error, runner),
        error,
        pin.path,
      );
      runner.assertExhausted();
    } finally {
      await Deno.remove(pin.directory, { recursive: true });
    }
  });
}

Deno.test("npm tarball composite preserves injected JSON error identity", async (): Promise<void> => {
  const pin = await tempPin();
  const runner = new FakeCommandRunner([]);
  const packageLockPath = `${pin.directory}/package-lock.json`;
  const packageLockSentinel = Uint8Array.from([NON_TEXT_BYTE, 0, 128]);
  await Deno.writeFile(packageLockPath, packageLockSentinel);
  const metadataUrl = "https://registry.npmjs.org/example";
  const failure = jsonFailure(metadataUrl);
  try {
    await assertFailure(
      (): Effect.Effect<void, Error> =>
        updateNpmTarballPackage({
          args: [],
          importMetaUrl: new globalThis.URL(`file://${pin.directory}/update.ts`).href,
          jsonClient: failure.client.client,
          packageName: "example",
          runner,
        }),
      failure.error,
      pin.path,
    );
    assertEquals(await Deno.readFile(packageLockPath), packageLockSentinel);
    failure.client.assertExhausted();
    runner.assertExhausted();
  } finally {
    await Deno.remove(pin.directory, { recursive: true });
  }
});

Deno.test("Deno update preserves release HTTP error before snapshot work", async (): Promise<void> => {
  const pin = await tempPin();
  const baseUrl = "https://dl.deno.land/release/v1.0.1";
  const url = `${baseUrl}/deno-aarch64-apple-darwin.zip.sha256sum`;
  const expectedRequest = request(url);
  const expectedResponse = {
    ...response(url),
    status: SERVICE_UNAVAILABLE_STATUS,
    statusText: "Service Unavailable",
  };
  const error = httpStatusError(expectedRequest, expectedResponse);
  const http = strictHttpClient([
    {
      effect: (): Effect.Effect<never, typeof error> => Effect.fail(error),
      request: expectedRequest,
    },
    {
      effect: (): Effect.Effect<never> => Effect.never,
      request: request(`${baseUrl}/deno-aarch64-unknown-linux-gnu.zip.sha256sum`),
    },
    {
      effect: (): Effect.Effect<never> => Effect.never,
      request: request(`${baseUrl}/deno-x86_64-unknown-linux-gnu.zip.sha256sum`),
    },
  ]);
  const json = strictJsonClient([]);
  const runner = new FakeCommandRunner([]);
  try {
    await assertFailure(
      (): ReturnType<typeof updateDeno> =>
        updateDeno(["1.0.1"], {
          httpClient: http.client,
          jsonClient: json.client,
          pinFilePath: pin.path,
          runner,
        }),
      error,
      pin.path,
    );
    http.assertExhausted();
    json.assertExhausted();
    runner.assertExhausted();
  } finally {
    await Deno.remove(pin.directory, { recursive: true });
  }
});
