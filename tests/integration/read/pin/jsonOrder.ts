import { describe, it } from "@jsr/std__testing/bdd";
import { assertEquals } from "@jsr/std__assert";
import { parseSriHash } from "coolheaded/pin/sriHash.ts";
import { serializePinJson } from "coolheaded/pin/json.ts";
import { systemRecord } from "coolheaded/system/target.ts";

const SHA256_BASE64_CONTENT_LENGTH = 43;
const SHA512_BASE64_CONTENT_LENGTH = 86;

describe("pin JSON", (): void => {
  it("serializes fields in canonical order", (): void => {
    const serialized = serializePinJson({
      binaryVersion: "2.0.0",
      cargoVendorHash: "cargo-vendor-hash",
      npmVendorHash: "npm-vendor-hash",
      packageHash: parseSriHash(`sha256-${"A".repeat(SHA256_BASE64_CONTENT_LENGTH)}=`),
      platformPackageHashes: systemRecord(() =>
        parseSriHash(`sha512-${"A".repeat(SHA512_BASE64_CONTENT_LENGTH)}==`),
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
});
