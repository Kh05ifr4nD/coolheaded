import { describe, it } from "@jsr/std__testing/bdd";
import { gitAuthEnv, gitRemoteHost, parseConfig } from "coolheadedCi/createUpdatePr.ts";
import { assertEquals } from "@jsr/std__assert";

describe("update PR config", (): void => {
  it("defaults to automated dependency labels and auto-merge", (): void => {
    assertEquals(
      parseConfig(["--branch", "update/package/codex", "--title", "codex: 1.0.0 -> 1.0.1"]),
      {
        autoMerge: true,
        body: "",
        branch: "update/package/codex",
        dryRun: false,
        labels: ["dependencies", "automated"],
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
        labels: ["dependencies", "automated", "deno-deps"],
        title: "deno.lock: update dependencies",
      },
    );
  });
});

describe("gitRemoteHost", (): void => {
  it("extracts hosts from common remote URL forms", (): void => {
    assertEquals(gitRemoteHost("https://example.test/owner/repo.git"), "example.test");
    assertEquals(gitRemoteHost("git@example.test:owner/repo.git"), "example.test");
    assertEquals(gitRemoteHost("ssh://git@example.test/owner/repo.git"), "example.test");
  });
});

describe("gitAuthEnv", (): void => {
  it("builds process-local GitHub extraheader config", async (): Promise<void> => {
    Deno.env.set("GH_TOKEN", "test-token");
    Deno.env.set("GITHUB_SERVER_URL", "https://example.test/");
    try {
      assertEquals(await gitAuthEnv(), {
        GIT_CONFIG_COUNT: "1",
        GIT_CONFIG_KEY_0: "http.https://example.test/.extraheader",
        GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${globalThis.btoa("x-access-token:test-token")}`,
      });
    } finally {
      Deno.env.delete("GH_TOKEN");
      Deno.env.delete("GITHUB_SERVER_URL");
    }
  });
});
