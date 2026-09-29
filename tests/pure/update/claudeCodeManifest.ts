import { assertEquals, assertInstanceOf } from "@jsr/std__assert";
import { Effect } from "effect";
import { UpdateError } from "coolheaded/core/updateScript.ts";
import { hexSha256ToSRI } from "coolheaded/update/release.ts";
import { platformChecksums } from "coolheadedPackage/claudeCode/update.ts";

const VERSION = "2.1.284";
const CHECKSUMS = {
  "aarch64-darwin": "50a14c2f50f56668380fdda490167f1d3630d5cc18fb8aed3073c2c7ea7314fe",
  "aarch64-linux": "3dd0f96d7ada463152d20300186f6cfc6ab94b57e218f49e3ac86db42ac695a6",
  "x86_64-linux": "5cd90aabd83f8a15136c35aa37bb1d92b348993573316643dc3fe4e04afbf88f",
} as const;

function manifest(version: string = VERSION): Readonly<Record<string, unknown>> {
  return {
    platforms: {
      "darwin-arm64": { binary: "claude", checksum: CHECKSUMS["aarch64-darwin"] },
      "darwin-x64": { binary: "claude", checksum: "a".repeat(64) },
      "linux-arm64": { binary: "claude", checksum: CHECKSUMS["aarch64-linux"] },
      "linux-x64": { binary: "claude", checksum: CHECKSUMS["x86_64-linux"] },
    },
    version,
  };
}

Deno.test("claude code manifest keeps supported platform checksums", async (): Promise<void> => {
  const checksums = await Effect.runPromise(platformChecksums(manifest(), VERSION));

  assertEquals(checksums, CHECKSUMS);
  assertEquals(
    hexSha256ToSRI(checksums["x86_64-linux"]),
    "sha256-XNkKq9g/ihUTbDWqN7sdkrNImTVzMWZD3D/k4Er7+I8=",
  );
});

Deno.test("claude code manifest rejects a different version", async (): Promise<void> => {
  const mismatched = platformChecksums(manifest("2.1.283"), VERSION);
  const error = await Effect.runPromise(Effect.flip(mismatched));

  assertInstanceOf(error, UpdateError);
});

Deno.test("claude code manifest rejects a non-claude binary", async (): Promise<void> => {
  const { platforms } = manifest();
  if (platforms === null || typeof platforms !== "object" || Array.isArray(platforms)) {
    throw new TypeError("fixture platforms missing");
  }

  const replaced = platformChecksums(
    {
      platforms: {
        ...platforms,
        "linux-x64": { binary: "claude.exe", checksum: CHECKSUMS["x86_64-linux"] },
      },
      version: VERSION,
    },
    VERSION,
  );
  const error = await Effect.runPromise(Effect.flip(replaced));

  assertInstanceOf(error, UpdateError);
});
