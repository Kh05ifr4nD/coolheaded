import { describe, it } from "@jsr/std__testing/bdd";
import { SUPPORTED_SYSTEMS } from "coolheaded/system/target.ts";
import { assertEquals } from "@jsr/std__assert";
import { parsePackageHashConfig } from "coolheaded/pin/packageHashConfig.ts";
import { parseSriHash } from "coolheaded/pin/sriHash.ts";
import { serializePinJson } from "coolheaded/pin/json.ts";

const SHA256_BASE64_CONTENT_LENGTH = 43;
const SHA512_BASE64_CONTENT_LENGTH = 86;

describe("pin JSON", (): void => {
  it("serializes fields in canonical order", (): void => {
    const serialized = serializePinJson({
      binaryVersion: "2.0.0",
      cargoVendorHash: "cargo-vendor-hash",
      npmVendorHash: "npm-vendor-hash",
      packageHash: parseSriHash(`sha256-${"A".repeat(SHA256_BASE64_CONTENT_LENGTH)}=`),
      platformPackageHashes: Object.fromEntries(
        SUPPORTED_SYSTEMS.map(
          (system) =>
            [system, parseSriHash(`sha512-${"A".repeat(SHA512_BASE64_CONTENT_LENGTH)}==`)] as const,
        ),
      ),
      sourceHash: parseSriHash(`sha512-${"A".repeat(SHA512_BASE64_CONTENT_LENGTH)}==`),
      version: "1.0.0",
    });
    const parsed: unknown = JSON.parse(serialized);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new Error("serialized pin must be an object");
    }

    assertEquals(Object.keys(parsed), [
      "version",
      "binaryVersion",
      "packageHash",
      "platformPackageHashes",
      "sourceHash",
      "cargoVendorHash",
      "npmVendorHash",
    ]);
  });

  it("round trips only declared platform hashes", (): void => {
    const hash = parseSriHash(`sha256-${"A".repeat(SHA256_BASE64_CONTENT_LENGTH)}=`);
    const serialized = serializePinJson({
      platformPackageHashes: { "aarch64-darwin": hash },
      version: "2.23.0",
    });
    const value: unknown = JSON.parse(serialized);
    const config = parsePackageHashConfig(value);

    assertEquals(config.platformPackageHashes, { "aarch64-darwin": hash });
  });
});
