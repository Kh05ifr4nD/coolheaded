import {
  InvalidPackageHashConfigError,
  parsePackageHashConfig,
} from "coolheaded/pin/packageHashConfig.ts";
import { assertEquals, assertThrows } from "@jsr/std__assert";
import { assertProperty, defineReplayTarget } from "coolheadedTestSupport/fastCheck.ts";
import { describe, it } from "@jsr/std__testing/bdd";
import fc from "fast-check";

const SHA256_LENGTH = 32;
const SHA512_LENGTH = 64;
const MAX_BYTE = 255;

function zeroHash(algorithm: string, length: number): string {
  const binary = String.fromCodePoint(...new Uint8Array(length));
  return `${algorithm}-${globalThis.btoa(binary)}`;
}

function digestArbitrary(length: number): fc.Arbitrary<readonly number[]> {
  return fc
    .array(fc.integer({ max: MAX_BYTE, min: 0 }), { maxLength: length, minLength: length })
    .map((digest: readonly number[]): readonly number[] => Object.freeze(digest));
}

const SHA256_ZERO = zeroHash("sha256", SHA256_LENGTH);
const SHA512_ZERO = zeroHash("sha512", SHA512_LENGTH);
const COMPLETE_HASHES = {
  "aarch64-darwin": SHA256_ZERO,
  "aarch64-linux": SHA512_ZERO,
  "x86_64-linux": SHA256_ZERO,
} as const;

describe("parsePackageHashConfig", (): void => {
  it("accepts complete package pins", (): void => {
    const config = parsePackageHashConfig({
      platformPackageHashes: COMPLETE_HASHES,
      version: "0.137.0",
    });

    assertEquals(config.version, "0.137.0");
    assertEquals(config.platformPackageHashes["x86_64-linux"], SHA256_ZERO);
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
            "aarch64-darwin": SHA256_ZERO,
            "aarch64-linux": SHA512_ZERO,
          },
          version: "0.137.0",
        });
      },
      Error,
      "Missing hash for x86_64-linux",
    );
  });

  it("maps invalid SRI hashes to system-specific config errors", (): void => {
    for (const invalidHash of ["", 1, "sha1-a", "sha256-YQ==", `${SHA256_ZERO} ${SHA256_ZERO}`]) {
      assertThrows(
        (): void => {
          parsePackageHashConfig({
            platformPackageHashes: {
              ...COMPLETE_HASHES,
              "aarch64-linux": invalidHash,
            },
            version: "0.137.0",
          });
        },
        InvalidPackageHashConfigError,
        "Invalid hash for aarch64-linux",
      );
    }
  });
});

const validHashesName = "package hash config preserves generated canonical SRI hashes";
Deno.test(validHashesName, (): void => {
  const target = defineReplayTarget("tests/pin/packageHashConfig.ts", validHashesName);
  assertProperty(
    target,
    fc.property(
      digestArbitrary(SHA256_LENGTH),
      digestArbitrary(SHA512_LENGTH),
      (sha256Digest: readonly number[], sha512Digest: readonly number[]): void => {
        const sha256 = `sha256-${globalThis.btoa(String.fromCodePoint(...sha256Digest))}`;
        const sha512 = `sha512-${globalThis.btoa(String.fromCodePoint(...sha512Digest))}`;
        const config = parsePackageHashConfig({
          platformPackageHashes: {
            "aarch64-darwin": sha256,
            "aarch64-linux": sha512,
            "x86_64-linux": sha256,
          },
          version: "0.137.0",
        });

        assertEquals(config.platformPackageHashes["aarch64-darwin"], sha256);
        assertEquals(config.platformPackageHashes["aarch64-linux"], sha512);
        assertEquals(config.platformPackageHashes["x86_64-linux"], sha256);
      },
    ),
  );
});
