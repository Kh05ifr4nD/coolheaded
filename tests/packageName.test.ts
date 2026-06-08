import { assertEquals, assertThrows } from "@jsr/std__assert";
import { describe, it } from "@jsr/std__testing/bdd";
import fc from "fast-check";

import { parsePackageName } from "coolheaded/packageName.ts";

const PACKAGE_NAME_PATTERN = /^[a-z][A-Za-z0-9]*$/u;

describe("parsePackageName", (): void => {
  it("accepts codex", (): void => {
    assertEquals(parsePackageName("codex"), "codex");
  });

  it("rejects scoped npm names as package directory names", (): void => {
    assertThrows(
      (): void => {
        parsePackageName("@openai/codex");
      },
      Error,
      "Invalid package name: @openai/codex",
    );
  });

  it("rejects hyphenated package directory names", (): void => {
    assertThrows(
      (): void => {
        parsePackageName("code-review-graph");
      },
      Error,
      "Invalid package name: code-review-graph",
    );
  });

  it("accepts camelCase package directory names", (): void => {
    assertEquals(parsePackageName("codeReviewGraph"), "codeReviewGraph");

    fc.assert(
      fc.property(fc.stringMatching(PACKAGE_NAME_PATTERN), (name: string): void => {
        assertEquals(parsePackageName(name), name);
      }),
    );
  });
});
