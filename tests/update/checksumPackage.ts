import {
  ASSET_BODIES,
  EMPTY_HASH,
  NON_UTF8_BYTE,
  NON_UTF8_HASH,
  PACKAGES,
  THIRD_HASH,
  VERSION,
  WRONG_HASH,
  assetUrls,
  manifest,
  pinPath,
  runFailure,
  successPlan,
} from "./checksumPackageFixture.ts";
import { strictHttpClient, strictJsonClient } from "coolheadedTestSupport/httpClient.ts";
import { Effect } from "effect";
import { assertEquals } from "@jsr/std__assert";

const INITIAL_PIN = new globalThis.TextEncoder().encode(
  '{"version":"0.0.0","sentinel":"unchanged"}\n',
);

for (const fixture of PACKAGES) {
  Deno.test(`${fixture.repo} checksum update downloads manifest and three assets`, async (): Promise<void> => {
    const urls = assetUrls(fixture);
    const path = await pinPath(INITIAL_PIN);
    const http = strictHttpClient([
      successPlan(fixture.manifestUrl, [...manifest(fixture)]),
      successPlan(urls[0], ASSET_BODIES[0]),
      successPlan(urls[1], ASSET_BODIES[1]),
      successPlan(urls[2], ASSET_BODIES[2]),
    ]);
    const json = strictJsonClient([]);
    try {
      await Effect.runPromise(
        fixture.program([VERSION], {
          httpClient: http.client,
          jsonClient: json.client,
          pinFilePath: path,
        }),
      );
      assertEquals(JSON.parse(await Deno.readTextFile(path)), {
        platformPackageHashes: {
          "aarch64-darwin": "sha256-47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=",
          "aarch64-linux": "sha256-7xkrevVOlD8garJwdewYBThMlyyZWfxYIPH6fVJo/O8=",
          "x86_64-linux": "sha256-65Kv6u+hKcaOdOM/ZI+W4huRs21Iv2TTodcgU7DPRPg=",
        },
        version: VERSION,
      });
      http.assertExhausted();
      json.assertExhausted();
    } finally {
      await Deno.remove(path);
    }
  });
  for (const [name, body, expected] of [
    [
      "missing",
      new globalThis.TextEncoder().encode(
        `${EMPTY_HASH}  ${fixture.assets[0]}\n${NON_UTF8_HASH}  ${fixture.assets[1]}`,
      ),
      { asset: fixture.assets[2], kind: "missing" },
    ],
    [
      "duplicate",
      new globalThis.TextEncoder().encode(
        `${new globalThis.TextDecoder().decode(manifest(fixture))}\n${THIRD_HASH}  ${
          fixture.assets[2]
        }`,
      ),
      { asset: fixture.assets[2], kind: "duplicate" },
    ],
    [
      "malformed",
      new globalThis.TextEncoder().encode(`${EMPTY_HASH.toUpperCase()}  ${fixture.assets[0]}`),
      { asset: "manifest", kind: "malformed" },
    ],
    ["invalid UTF-8", Uint8Array.from([NON_UTF8_BYTE]), { asset: "manifest", kind: "malformed" }],
  ] as const) {
    Deno.test(`${fixture.repo} checksum update rejects ${name} manifest`, async (): Promise<void> => {
      await runFailure(fixture, [successPlan(fixture.manifestUrl, [...body])], expected);
    });
  }
  Deno.test(`${fixture.repo} checksum update rejects third asset mismatch`, async (): Promise<void> => {
    const urls = assetUrls(fixture);
    await runFailure(
      fixture,
      [
        successPlan(fixture.manifestUrl, [
          ...manifest(fixture, [EMPTY_HASH, NON_UTF8_HASH, WRONG_HASH]),
        ]),
        successPlan(urls[0], ASSET_BODIES[0]),
        successPlan(urls[1], ASSET_BODIES[1]),
        successPlan(urls[2], ASSET_BODIES[2]),
      ],
      {
        actual: THIRD_HASH,
        asset: fixture.assets[2],
        expected: WRONG_HASH,
        kind: "mismatch",
      },
    );
  });
}
