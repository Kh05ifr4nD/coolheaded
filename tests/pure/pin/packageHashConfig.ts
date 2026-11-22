import {
  InvalidPackageHashConfigError,
  parsePackageHashConfig,
} from "coolheaded/pin/packageHashConfig.ts";
import { assertEquals, assertThrows } from "@jsr/std__assert";
import { assertProperty, defineReplayTarget } from "coolheadedTestSupport/fastCheck.ts";
import { describe, it } from "@jsr/std__testing/bdd";
import fc from "fast-check";
import { parsePackageSystems } from "coolheaded/system/target.ts";
import { parseSriHash } from "coolheaded/pin/sriHash.ts";

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

const SHA256_ZERO = parseSriHash(zeroHash("sha256", SHA256_LENGTH));
const SHA512_ZERO = parseSriHash(zeroHash("sha512", SHA512_LENGTH));
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

  it("accepts a single platform pin", (): void => {
    const config = parsePackageHashConfig({
      platformPackageHashes: { "aarch64-darwin": SHA256_ZERO },
      version: "2.23.0",
    });

    assertEquals(config.platformPackageHashes, { "aarch64-darwin": SHA256_ZERO });
  });

  it("preserves any selected platform pins", (): void => {
    const platformPackageHashes = {
      "aarch64-darwin": SHA256_ZERO,
      "x86_64-linux": SHA512_ZERO,
    } as const;
    const config = parsePackageHashConfig({ platformPackageHashes, version: "1.0.0" });

    assertEquals(config.platformPackageHashes, platformPackageHashes);
  });

  it("rejects empty platform pins", (): void => {
    assertThrows(
      (): void => {
        parsePackageHashConfig({
          platformPackageHashes: {},
          version: "0.137.0",
        });
      },
      InvalidPackageHashConfigError,
      "platformPackageHashes must not be empty",
    );
  });

  it("rejects unsupported platform pin keys", (): void => {
    assertThrows(
      (): void => {
        parsePackageHashConfig({
          platformPackageHashes: { "linux-riscv64": SHA256_ZERO },
          version: "0.137.0",
        });
      },
      InvalidPackageHashConfigError,
      "Unsupported system for pin hash: linux-riscv64",
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

describe("parsePackageSystems", (): void => {
  it("accepts a package's declared system subset", (): void => {
    assertEquals(parsePackageSystems(["aarch64-darwin"]), ["aarch64-darwin"]);
  });

  it("rejects an empty system list", (): void => {
    assertThrows(
      (): void => {
        parsePackageSystems([]);
      },
      TypeError,
      "Package systems must be a non-empty array",
    );
  });

  it("rejects non-array values and non-string entries", (): void => {
    assertThrows(
      (): void => {
        parsePackageSystems(null);
      },
      TypeError,
      "Package systems must be a non-empty array",
    );
    assertThrows(
      (): void => {
        parsePackageSystems([42]);
      },
      TypeError,
      "Unsupported package system: 42",
    );
  });

  it("rejects unsupported and duplicate systems", (): void => {
    assertThrows(
      (): void => {
        parsePackageSystems(["linux-riscv64"]);
      },
      TypeError,
      "Unsupported package system: linux-riscv64",
    );
    assertThrows(
      (): void => {
        parsePackageSystems(["aarch64-darwin", "aarch64-darwin"]);
      },
      TypeError,
      "Duplicate package system: aarch64-darwin",
    );
  });
});

const validHashesName = "package hash config preserves generated canonical SRI hashes";
Deno.test(validHashesName, (): void => {
  const target = defineReplayTarget("tests/pure/pin/packageHashConfig.ts", validHashesName);
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
