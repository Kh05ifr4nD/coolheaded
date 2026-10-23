import { assertEquals, assertInstanceOf } from "@jsr/std__assert";
import { describe, it } from "@jsr/std__testing/bdd";
import { Effect } from "effect";
import { commentCheckerPin } from "coolheadedPackage/lazyCodexAi/update.ts";

const HASH =
  "sha512-Ret0qHtgDhEemQYNduqSyaihFWJSOKae4YW3sUHS680G8K57CsRUkK6Gs4kbzDuWqiNUYs254+qu5hZZZSEKUA==";

function lockEntry(version: string, integrity: string): string {
  return JSON.stringify({
    packages: {
      "node_modules/@code-yeongyu/comment-checker": { integrity, version },
    },
  });
}

describe("LazyCodex runtime dependency pin", (): void => {
  it("uses the dependency pinned by the published plugin lock", async (): Promise<void> => {
    const pin = await Effect.runPromise(commentCheckerPin(lockEntry("0.8.0", HASH)));
    assertEquals(pin, { hash: HASH, version: "0.8.0" });
  });

  for (const contents of [
    "{",
    "{}",
    lockEntry("latest", HASH),
    lockEntry("0.8.0", "sha512-invalid"),
  ]) {
    it(`rejects an unusable dependency lock: ${contents}`, async (): Promise<void> => {
      const error = await Effect.runPromise(Effect.flip(commentCheckerPin(contents)));
      assertInstanceOf(error, Error);
    });
  }
});
