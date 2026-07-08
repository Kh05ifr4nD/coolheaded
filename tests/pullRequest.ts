import {
  classicProtectionHasRequiredChecks,
  parseConfig,
  rulesetHasRequiredChecks,
} from "coolheadedCi/update/pullRequest.ts";
import { describe, it } from "@jsr/std__testing/bdd";
import { assertEquals } from "@jsr/std__assert";

describe("update pull request config", (): void => {
  it("defaults to automated dependency labels and auto-merge", (): void => {
    assertEquals(
      parseConfig([
        "--branch",
        "update/package/examplePackage",
        "--title",
        "examplePackage: 1.0.0 -> 1.0.1",
      ]),
      {
        autoMerge: true,
        body: "",
        branch: "update/package/examplePackage",
        dryRun: false,
        labels: ["dependencies", "automated"],
        title: "examplePackage: 1.0.0 -> 1.0.1",
      },
    );
  });

  it("parses explicit labels, body, dry-run, and disabled auto-merge", (): void => {
    assertEquals(
      parseConfig([
        "--branch",
        "update/denoDependencies",
        "--title",
        "deno.lock: update Deno dependencies",
        "--body",
        "effect: 1 -> 2",
        "--labels",
        "dependencies,automated,denoDependencies",
        "--auto-merge",
        "false",
        "--dry-run",
      ]),
      {
        autoMerge: false,
        body: "effect: 1 -> 2",
        branch: "update/denoDependencies",
        dryRun: true,
        labels: ["dependencies", "automated", "denoDependencies"],
        title: "deno.lock: update Deno dependencies",
      },
    );
  });
});

describe("update pull request auto-merge gates", (): void => {
  it("recognizes classic required status checks", (): void => {
    assertEquals(classicProtectionHasRequiredChecks({ contexts: ["CI / check"] }), true);
    assertEquals(classicProtectionHasRequiredChecks({ checks: [{ context: "CI / check" }] }), true);
    assertEquals(classicProtectionHasRequiredChecks({ checks: [], contexts: [] }), false);
  });

  it("recognizes active rulesets with required status checks for main", (): void => {
    assertEquals(
      rulesetHasRequiredChecks(
        {
          conditions: { ref_name: { include: ["~DEFAULT_BRANCH"] } },
          enforcement: "active",
          rules: [
            {
              parameters: {
                required_status_checks: [{ context: "CI / check" }],
              },
              type: "required_status_checks",
            },
          ],
          target: "branch",
        },
        "main",
      ),
      true,
    );
  });

  it("rejects rulesets without concrete required status checks", (): void => {
    assertEquals(
      rulesetHasRequiredChecks(
        {
          enforcement: "active",
          rules: [{ parameters: { required_status_checks: [] }, type: "required_status_checks" }],
          target: "branch",
        },
        "main",
      ),
      false,
    );
  });
});
