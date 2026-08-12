import { describe, it } from "@jsr/std__testing/bdd";
import {
  directSpecifierVersions,
  versionChanges,
} from "coolheadedCi/update/run/denoDependencies.ts";
import { assertEquals } from "@jsr/std__assert";

describe("Deno dependencies update helpers", (): void => {
  it("returns direct specifier versions", (): void => {
    assertEquals(
      directSpecifierVersions({
        specifiers: {
          "npm:effect@*": "3.21.2",
        },
      }),
      {
        "npm:effect@*": "3.21.2",
      },
    );
  });

  it("summarizes direct dependency version changes", (): void => {
    assertEquals(
      versionChanges(
        {
          "npm:effect@*": "3.21.2",
          "npm:fast-check@*": "3.23.2",
        },
        {
          "npm:effect@*": "3.21.3",
          "npm:fast-check@*": "3.23.2",
        },
      ),
      "npm:effect@*: 3.21.2 -> 3.21.3",
    );
  });
});
