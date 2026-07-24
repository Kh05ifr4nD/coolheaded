import {
  InvalidSriHashError,
  formatSriHash,
  parseSriHash,
  sriHashAlgorithm,
  sriHashDigest,
} from "coolheaded/pin/sriHash.ts";
import { assertEquals, assertThrows } from "@jsr/std__assert";
import { assertProperty, defineReplayTarget } from "coolheadedTestSupport/fastCheck.ts";
import { describe, it } from "@jsr/std__testing/bdd";
import fc from "fast-check";

const SHA256_LENGTH = 32;
const SHA512_LENGTH = 64;
const MAX_BYTE = 255;
const algorithmAndLength = fc.constantFrom(
  ["sha256", SHA256_LENGTH] as const,
  ["sha512", SHA512_LENGTH] as const,
);

function base64(bytes: readonly number[]): string {
  return globalThis.btoa(String.fromCodePoint(...bytes));
}

function digestArbitrary(length: number): fc.Arbitrary<readonly number[]> {
  return fc
    .array(fc.integer({ max: MAX_BYTE, min: 0 }), { maxLength: length, minLength: length })
    .map((digest: readonly number[]): readonly number[] => Object.freeze(digest));
}

describe("SRI hash boundary", (): void => {
  it("rejects unsupported, malformed, noncanonical, and wrong-length hashes", (): void => {
    const sha256 = base64(Array.from({ length: SHA256_LENGTH }, (): number => 0));
    const sha512 = base64(Array.from({ length: SHA512_LENGTH }, (): number => 0));
    for (const value of [
      "",
      `sha1-${sha256}`,
      `SHA256-${sha256}`,
      "sha256-!",
      `sha256-${sha256.slice(0, -1)}`,
      `sha256-${sha512}`,
      `sha512-${sha256}`,
      `sha256- ${sha256}`,
      `sha256-${sha256} sha512-${sha512}`,
      `sha256-${sha256}\n`,
    ]) {
      assertThrows((): void => {
        parseSriHash(value);
      }, InvalidSriHashError);
    }
    assertThrows((): void => {
      parseSriHash(1);
    }, InvalidSriHashError);
  });

  it("rejects invalid byte values without coercion", (): void => {
    const fractionalByte = 1.5;
    for (const invalid of [-1, 256, fractionalByte, Number.NaN, "0"]) {
      const digest: unknown[] = Array.from({ length: SHA256_LENGTH }, (): number => 0);
      digest[0] = invalid;
      assertThrows((): void => {
        formatSriHash("sha256", digest);
      }, InvalidSriHashError);
    }
    assertThrows((): void => {
      formatSriHash(
        "toString",
        Array.from({ length: SHA256_LENGTH }, (): number => 0),
      );
    }, InvalidSriHashError);
  });
});

const roundtripName = "SRI hashes roundtrip through an independent byte and base64 oracle";
Deno.test(roundtripName, (): void => {
  const target = defineReplayTarget("tests/pin/sriHash.ts", roundtripName);
  assertProperty(
    target,
    fc.property(
      algorithmAndLength.chain(([algorithm, length]) =>
        digestArbitrary(length).map(
          (digest: readonly number[]): readonly [typeof algorithm, readonly number[]] => [
            algorithm,
            digest,
          ],
        ),
      ),
      ([algorithm, digest]): void => {
        const expected = `${algorithm}-${base64([...digest])}`;
        const formatted = formatSriHash(algorithm, [...digest]);
        const parsed = parseSriHash(expected);

        assertEquals(formatted, expected);
        assertEquals(parsed, expected);
        assertEquals(sriHashAlgorithm(parsed), algorithm);
        assertEquals(sriHashDigest(parsed), [...digest]);
      },
    ),
  );
});

const wrongLengthName = "SRI hashes reject generated wrong algorithm lengths";
Deno.test(wrongLengthName, (): void => {
  const target = defineReplayTarget("tests/pin/sriHash.ts", wrongLengthName);
  assertProperty(
    target,
    fc.property(
      fc
        .constantFrom(
          ["sha256", SHA256_LENGTH - 1] as const,
          ["sha256", SHA256_LENGTH + 1] as const,
          ["sha512", SHA512_LENGTH - 1] as const,
          ["sha512", SHA512_LENGTH + 1] as const,
        )
        .chain(([algorithm, length]) =>
          digestArbitrary(length).map(
            (digest: readonly number[]): readonly [typeof algorithm, readonly number[]] => [
              algorithm,
              digest,
            ],
          ),
        ),
      ([algorithm, digest]): void => {
        assertThrows((): void => {
          formatSriHash(algorithm, [...digest]);
        }, InvalidSriHashError);
      },
    ),
  );
});
