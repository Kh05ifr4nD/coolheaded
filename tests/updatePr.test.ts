import { describe, it } from "@jsr/std__testing/bdd";
import { assertEquals } from "@jsr/std__assert";
import { parseConfig } from "coolheadedCi/createUpdatePr.ts";

describe("update PR config", (): void => {
  it("defaults to automated dependency labels and auto-merge", (): void => {
    assertEquals(
      parseConfig([
        "--branch",
        "update/package/codex",
        "--title",
        "codex: 1.0.0 -> 1.0.1",
      ]),
      {
        autoMerge: true,
        body: "",
        branch: "update/package/codex",
        dryRun: false,
        labels: [
          "dependencies",
          "automated",
        ],
        title: "codex: 1.0.0 -> 1.0.1",
      },
    );
  });

  it("parses explicit labels, body, dry-run, and disabled auto-merge", (): void => {
    assertEquals(
      parseConfig([
        "--branch",
        "update/denoDeps",
        "--title",
        "deno.lock: update dependencies",
        "--body",
        "effect: 1 -> 2",
        "--labels",
        "dependencies,automated,deno-deps",
        "--auto-merge",
        "false",
        "--dry-run",
      ]),
      {
        autoMerge: false,
        body: "effect: 1 -> 2",
        branch: "update/denoDeps",
        dryRun: true,
        labels: [
          "dependencies",
          "automated",
          "deno-deps",
        ],
        title: "deno.lock: update dependencies",
      },
    );
  });
});
