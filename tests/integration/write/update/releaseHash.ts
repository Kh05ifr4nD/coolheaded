import type { HttpRequest, HttpResponse } from "coolheaded/core/httpClient.ts";
import { describe, it } from "@jsr/std__testing/bdd";
import {
  hexSha256ToSRI,
  releaseHashUpdateProgram,
  releaseUrlsFromTargets,
} from "coolheaded/update/release.ts";
import { Effect } from "effect";
import { assertEquals } from "@jsr/std__assert";
import { calendarVersionScheme } from "coolheaded/core/version.ts";
import { strictHttpClient } from "coolheadedTestSupport/httpClient.ts";

const HTTP_OK = 200;
const REQUEST_TIMEOUT_MS = 30_000;
const EMPTY_SHA256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
const EMPTY_SRI = "sha256-47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=";
type ExpectedHttpRequest = Parameters<typeof strictHttpClient>[0][number];

function request(url: string): HttpRequest {
  return { headers: {}, method: "GET", timeoutMs: REQUEST_TIMEOUT_MS, url };
}

function response(url: string, body: readonly number[]): HttpResponse {
  const responseBody = Uint8Array.from(body);
  return {
    body: responseBody,
    headers: {},
    status: HTTP_OK,
    statusText: "OK",
    url,
  };
}

function encoded(text: string): readonly number[] {
  const encoder = new globalThis.TextEncoder();
  return [...encoder.encode(text)];
}

function plan(url: string, body: readonly number[]): ExpectedHttpRequest {
  return {
    effect: (): Effect.Effect<HttpResponse> => {
      const httpResponse = response(url, body);
      return Effect.succeed(httpResponse);
    },
    request: request(url),
  };
}

describe("release helpers", (): void => {
  it("maps release targets through supported systems", (): void => {
    const urls = releaseUrlsFromTargets(
      {
        "aarch64-darwin": "darwin_arm64",
        "aarch64-linux": "linux_arm64",
        "x86_64-linux": "linux_amd64",
      },
      (target: string): string => `https://example.test/${target}.tar.gz`,
    );
    assertEquals(urls, {
      "aarch64-darwin": "https://example.test/darwin_arm64.tar.gz",
      "aarch64-linux": "https://example.test/linux_arm64.tar.gz",
      "x86_64-linux": "https://example.test/linux_amd64.tar.gz",
    });
  });

  it("converts hex sha256 values to SRI hashes", (): void => {
    const sri = hexSha256ToSRI(EMPTY_SHA256);
    assertEquals(sri, EMPTY_SRI);
  });
});

describe("release hash updates", (): void => {
  it("writes release hash pins through the shared update program", async (): Promise<void> => {
    const pinFilePath = await Deno.makeTempFile();
    const urls = {
      "aarch64-darwin": "https://example.test/releases/v0.1.0/darwin_arm64.tar.gz",
      "aarch64-linux": "https://example.test/releases/v0.1.0/linux_arm64.tar.gz",
      "x86_64-linux": "https://example.test/releases/v0.1.0/linux_amd64.tar.gz",
    } as const;
    const hashBody = encoded(EMPTY_SHA256);
    const expectedRequests = [
      plan(urls["aarch64-darwin"], hashBody),
      plan(urls["aarch64-linux"], hashBody),
      plan(urls["x86_64-linux"], hashBody),
    ];
    const strict = strictHttpClient(expectedRequests);

    try {
      const update = releaseHashUpdateProgram({
        args: ["0.1.0"],
        httpClient: strict.client,
        latestVersion: (): Effect.Effect<string, Error> => Effect.succeed("0.2.0"),
        pinFilePath,
        source: "sha256Sum",
        urlsForVersion: (): typeof urls => urls,
      });
      await Effect.runPromise(update);

      const pinText = await Deno.readTextFile(pinFilePath);
      const pin: unknown = JSON.parse(pinText);
      assertEquals(pin, {
        platformPackageHashes: {
          "aarch64-darwin": EMPTY_SRI,
          "aarch64-linux": EMPTY_SRI,
          "x86_64-linux": EMPTY_SRI,
        },
        version: "0.1.0",
      });
      strict.assertExhausted();
    } finally {
      await Deno.remove(pinFilePath);
    }
  });

  it("hashes release response bodies directly for sha256Digest", async (): Promise<void> => {
    const pinFilePath = await Deno.makeTempFile();
    const urls = {
      "aarch64-darwin": "https://example.test/digest/darwin",
      "aarch64-linux": "https://example.test/digest/linux-arm64",
      "x86_64-linux": "https://example.test/digest/linux-amd64",
    } as const;
    const emptyBody: readonly number[] = [];
    const expectedRequests = [
      plan(urls["aarch64-darwin"], emptyBody),
      plan(urls["aarch64-linux"], emptyBody),
      plan(urls["x86_64-linux"], emptyBody),
    ];
    const strict = strictHttpClient(expectedRequests);
    try {
      const update = releaseHashUpdateProgram({
        args: ["0.1.0"],
        httpClient: strict.client,
        latestVersion: (): Effect.Effect<string, Error> => Effect.succeed("0.2.0"),
        pinFilePath,
        source: "sha256Digest",
        urlsForVersion: (): typeof urls => urls,
      });
      await Effect.runPromise(update);
      const pinText = await Deno.readTextFile(pinFilePath);
      const pin: unknown = JSON.parse(pinText);
      assertEquals(pin, {
        platformPackageHashes: {
          "aarch64-darwin": EMPTY_SRI,
          "aarch64-linux": EMPTY_SRI,
          "x86_64-linux": EMPTY_SRI,
        },
        version: "0.1.0",
      });
      strict.assertExhausted();
    } finally {
      await Deno.remove(pinFilePath);
    }
  });

  it("uses calendar version ordering for release updates", async (): Promise<void> => {
    const pinFilePath = await Deno.makeTempFile();
    await Deno.writeTextFile(pinFilePath, '{ "version": "2024.01.02" }\n');
    const urls = {
      "aarch64-darwin": "https://example.test/calendar/darwin",
      "aarch64-linux": "https://example.test/calendar/linux-arm64",
      "x86_64-linux": "https://example.test/calendar/linux-amd64",
    } as const;
    const hashBody = encoded(EMPTY_SHA256);
    const expectedRequests = [
      plan(urls["aarch64-darwin"], hashBody),
      plan(urls["aarch64-linux"], hashBody),
      plan(urls["x86_64-linux"], hashBody),
    ];
    const strict = strictHttpClient(expectedRequests);
    try {
      const update = releaseHashUpdateProgram({
        args: [],
        httpClient: strict.client,
        latestVersion: (): Effect.Effect<string, Error> => Effect.succeed("2024.01.03"),
        pinFilePath,
        source: "sha256Sum",
        urlsForVersion: (): typeof urls => urls,
        versionScheme: calendarVersionScheme,
      });
      await Effect.runPromise(update);
      const pinText = await Deno.readTextFile(pinFilePath);
      const parsed: unknown = JSON.parse(pinText);
      if (typeof parsed !== "object" || parsed === null || !("version" in parsed)) {
        throw new Error("expected pin version");
      }
      assertEquals(parsed.version, "2024.01.03");
      strict.assertExhausted();
    } finally {
      await Deno.remove(pinFilePath);
    }
  });
});
