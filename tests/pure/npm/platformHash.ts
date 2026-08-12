import { assertEquals, assertInstanceOf, assertRejects } from "@jsr/std__assert";
import { describe, it } from "@jsr/std__testing/bdd";
import { npmHashConfigForSystems, npmHashesForSystems } from "coolheaded/npm/platformHash.ts";
import { Effect } from "effect";
import { InvalidPackageHashConfigError } from "coolheaded/pin/packageHashConfig.ts";
import { parseSriHash } from "coolheaded/pin/sriHash.ts";

const SHA512_DARWIN = parseSriHash(
  "sha512-AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQ==",
);
const SHA512_LINUX_ARM = parseSriHash(
  "sha512-AgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg==",
);
const SHA512_LINUX_X64 = parseSriHash(
  "sha512-AwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAw==",
);

describe("npm platform hashes", (): void => {
  it("maps platform suffixes to integrity hashes through Effect", async (): Promise<void> => {
    const hashes = await Effect.runPromise(
      npmHashesForSystems(
        { versions: { "0.137.0-linux-x64": { dist: { integrity: SHA512_LINUX_X64 } } } },
        "0.137.0",
        { "x86_64-linux": "linux-x64" },
      ),
    );
    assertEquals(hashes, { "x86_64-linux": SHA512_LINUX_X64 });
  });

  it("fails when platform metadata is missing", async (): Promise<void> => {
    await assertRejects(
      async (): Promise<void> => {
        await Effect.runPromise(
          npmHashesForSystems({ versions: {} }, "0.137.0", {
            "x86_64-linux": "linux-x64",
          }),
        );
      },
      Error,
      "Missing npm integrity for 0.137.0-linux-x64",
    );
  });

  it("keeps requested version in generated config", async (): Promise<void> => {
    const config = await Effect.runPromise(
      npmHashConfigForSystems(
        {
          versions: {
            "0.137.0-darwin-arm64": { dist: { integrity: SHA512_DARWIN } },
            "0.137.0-linux-arm64": { dist: { integrity: SHA512_LINUX_ARM } },
            "0.137.0-linux-x64": { dist: { integrity: SHA512_LINUX_X64 } },
          },
        },
        "0.137.0",
        {
          "aarch64-darwin": "darwin-arm64",
          "aarch64-linux": "linux-arm64",
          "x86_64-linux": "linux-x64",
        },
      ),
    );
    assertEquals(config, {
      platformPackageHashes: {
        "aarch64-darwin": SHA512_DARWIN,
        "aarch64-linux": SHA512_LINUX_ARM,
        "x86_64-linux": SHA512_LINUX_X64,
      },
      version: "0.137.0",
    });
  });

  it("fails malformed integrity as typed config error", async (): Promise<void> => {
    const error = await Effect.runPromise(
      Effect.flip(
        npmHashConfigForSystems(
          {
            versions: {
              "0.137.0-darwin-arm64": { dist: { integrity: "sha512-invalid" } },
              "0.137.0-linux-arm64": { dist: { integrity: SHA512_LINUX_ARM } },
              "0.137.0-linux-x64": { dist: { integrity: SHA512_LINUX_X64 } },
            },
          },
          "0.137.0",
          {
            "aarch64-darwin": "darwin-arm64",
            "aarch64-linux": "linux-arm64",
            "x86_64-linux": "linux-x64",
          },
        ),
      ),
    );
    assertInstanceOf(error, InvalidPackageHashConfigError);
  });
});
