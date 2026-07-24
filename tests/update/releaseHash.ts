import { describe, it } from "@jsr/std__testing/bdd";
import {
  hexSha256ToSRI,
  releaseHashUpdateProgram,
  releaseUrlsFromTargets,
} from "coolheaded/update/release.ts";
import { Effect } from "effect";
import type { HttpResponse } from "coolheaded/core/httpClient.ts";
import { assertEquals } from "@jsr/std__assert";
import { strictHttpClient } from "coolheadedTestSupport/httpClient.ts";

describe("release helpers", (): void => {
  it("maps release targets through supported systems", (): void => {
    assertEquals(
      releaseUrlsFromTargets(
        {
          "aarch64-darwin": "darwin_arm64",
          "aarch64-linux": "linux_arm64",
          "x86_64-linux": "linux_amd64",
        },
        (target: string): string => `https://example.test/${target}.tar.gz`,
      ),
      {
        "aarch64-darwin": "https://example.test/darwin_arm64.tar.gz",
        "aarch64-linux": "https://example.test/linux_arm64.tar.gz",
        "x86_64-linux": "https://example.test/linux_amd64.tar.gz",
      },
    );
  });

  it("converts hex sha256 values to SRI hashes", (): void => {
    assertEquals(
      hexSha256ToSRI("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"),
      "sha256-47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=",
    );
  });

  it("writes release hash pins through the shared update program", async (): Promise<void> => {
    const httpOk = 200;
    const requestTimeoutMs = 30_000;
    const pinFilePath = await Deno.makeTempFile();
    const emptySha256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
    const urls = releaseUrlsFromTargets(
      {
        "aarch64-darwin": "https://example.test/aarch64-darwin",
        "aarch64-linux": "https://example.test/aarch64-linux",
        "x86_64-linux": "https://example.test/x86_64-linux",
      },
      (target: string): string => target,
    );
    const strict = strictHttpClient(
      Object.values(urls).map((url: string) => ({
        effect: (): Effect.Effect<HttpResponse> =>
          Effect.succeed({
            body: new globalThis.TextEncoder().encode(emptySha256),
            headers: {},
            status: httpOk,
            statusText: "OK",
            url,
          }),
        request: { headers: {}, method: "GET", timeoutMs: requestTimeoutMs, url } as const,
      })),
    );

    try {
      await Effect.runPromise(
        releaseHashUpdateProgram({
          args: ["0.1.0"],
          httpClient: strict.client,
          latestVersion: (): Effect.Effect<string, Error> => Effect.succeed("0.2.0"),
          pinFilePath,
          source: "sha256Sum",
          urlsForVersion: () => urls,
        }),
      );

      assertEquals(JSON.parse(await Deno.readTextFile(pinFilePath)), {
        platformPackageHashes: {
          "aarch64-darwin": "sha256-47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=",
          "aarch64-linux": "sha256-47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=",
          "x86_64-linux": "sha256-47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=",
        },
        version: "0.1.0",
      });
      strict.assertExhausted();
    } finally {
      await Deno.remove(pinFilePath);
    }
  });
});
