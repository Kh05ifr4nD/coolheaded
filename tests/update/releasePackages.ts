import type { HttpRequest, HttpResponse } from "coolheaded/core/httpClient.ts";
import { strictHttpClient, strictJsonClient } from "coolheadedTestSupport/httpClient.ts";
import { Effect } from "effect";
import { assertEquals } from "@jsr/std__assert";
import { updateProgram as updateGh } from "coolheadedPackageGh";
import { updateProgram as updateYtDlp } from "coolheadedPackageYtDlp";

const VERSION = "1.2.3";
const CALENDAR_VERSION = "2026.07.04";
const EMPTY_HASH = "sha256-47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=";
const HTTP_OK = 200;
const TIMEOUT_MS = 30_000;
type Dependencies = Parameters<typeof updateGh>[1];
type Program = (args: readonly string[], dependencies: Dependencies) => Effect.Effect<void, Error>;

function response(url: string): HttpResponse {
  return { body: new Uint8Array(), headers: {}, status: HTTP_OK, statusText: "OK", url };
}

function request(url: string): HttpRequest {
  return { headers: {}, method: "GET", timeoutMs: TIMEOUT_MS, url };
}

async function checkPackage(
  program: Program,
  version: string,
  urls: readonly string[],
): Promise<void> {
  const pinFilePath = await Deno.makeTempFile();
  const http = strictHttpClient(
    urls.map((url: string) => ({
      effect: (): Effect.Effect<HttpResponse> => Effect.succeed(response(url)),
      request: request(url),
    })),
  );
  const json = strictJsonClient([]);
  try {
    await Effect.runPromise(
      program([version], { httpClient: http.client, jsonClient: json.client, pinFilePath }),
    );
    assertEquals(JSON.parse(await Deno.readTextFile(pinFilePath)), {
      platformPackageHashes: {
        "aarch64-darwin": EMPTY_HASH,
        "aarch64-linux": EMPTY_HASH,
        "x86_64-linux": EMPTY_HASH,
      },
      version,
    });
    http.assertExhausted();
    json.assertExhausted();
  } finally {
    await Deno.remove(pinFilePath);
  }
}

Deno.test("gh updater hashes the three supported release assets", async (): Promise<void> => {
  const base = `https://github.com/cli/cli/releases/download/v${VERSION}/gh_${VERSION}_`;
  await checkPackage(updateGh, VERSION, [
    `${base}macOS_arm64.zip`,
    `${base}linux_arm64.tar.gz`,
    `${base}linux_amd64.tar.gz`,
  ]);
});

Deno.test("yt-dlp updater hashes the three supported release assets", async (): Promise<void> => {
  const base = `https://github.com/yt-dlp/yt-dlp/releases/download/${CALENDAR_VERSION}/`;
  await checkPackage(updateYtDlp, CALENDAR_VERSION, [
    `${base}yt-dlp_macos`,
    `${base}yt-dlp_linux_aarch64`,
    `${base}yt-dlp_linux`,
  ]);
});
