import { assertEquals, assertThrows } from "@jsr/std__assert";
import { describe, it } from "@jsr/std__testing/bdd";
import fc from "fast-check";
import { parsePackageHashConfig } from "coolheaded/pin/packageHashConfig.ts";

const COMPLETE_HASHES = {
  "aarch64-darwin": "sha512-a",
  "aarch64-linux": "sha512-b",
  "x86_64-linux": "sha512-c",
} as const;

describe("parsePackageHashConfig", (): void => {
  it("accepts complete package pins", (): void => {
    const config = parsePackageHashConfig({
      platformPackageHashes: COMPLETE_HASHES,
      version: "0.137.0",
    });

    assertEquals(config.version, "0.137.0");
    assertEquals(config.platformPackageHashes["x86_64-linux"], "sha512-c");
  });

  it("accepts package pins with a distinct binary version", (): void => {
    const config = parsePackageHashConfig({
      binaryVersion: "0.54.0",
      platformPackageHashes: COMPLETE_HASHES,
      version: "1.69.0",
    });

    assertEquals(config.binaryVersion, "0.54.0");
    assertEquals(config.version, "1.69.0");
  });

  it("rejects invalid binary versions", (): void => {
    assertThrows(
      (): void => {
        parsePackageHashConfig({
          binaryVersion: "",
          platformPackageHashes: COMPLETE_HASHES,
          version: "1.69.0",
        });
      },
      Error,
      "binaryVersion must be a non-empty string",
    );
  });

  it("rejects missing platform pins", (): void => {
    assertThrows(
      (): void => {
        parsePackageHashConfig({
          platformPackageHashes: {
            "aarch64-darwin": "sha512-a",
            "aarch64-linux": "sha512-b",
          },
          version: "0.137.0",
        });
      },
      Error,
      "Missing hash for x86_64-linux",
    );
  });

  it("preserves arbitrary non-empty hashes", (): void => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1 }),
        fc.string({ minLength: 1 }),
        fc.string({ minLength: 1 }),
        (darwinHash: string, armHash: string, x64Hash: string): void => {
          const config = parsePackageHashConfig({
            platformPackageHashes: {
              "aarch64-darwin": darwinHash,
              "aarch64-linux": armHash,
              "x86_64-linux": x64Hash,
            },
            version: "0.137.0",
          });

          assertEquals(config.platformPackageHashes["aarch64-darwin"], darwinHash);
          assertEquals(config.platformPackageHashes["aarch64-linux"], armHash);
          assertEquals(config.platformPackageHashes["x86_64-linux"], x64Hash);
        },
      ),
    );
  });
});
