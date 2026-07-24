import { assertEquals, assertInstanceOf, assertStringIncludes } from "@jsr/std__assert";
import { compareVersions, isSemver } from "coolheaded/core/version.ts";
import { describe, it } from "@jsr/std__testing/bdd";
import {
  latestGitHubVersion,
  latestNpmVersion,
  latestPyPiVersion,
} from "coolheaded/source/version.ts";
import { Effect } from "effect";
import { UpdateError } from "coolheaded/core/updateScript.ts";
import { withMockedJsonFetch } from "coolheadedTestSupport/fetchMock.ts";

describe("latest version exports", (): void => {
  it("exposes latest query functions", (): void => {
    assertEquals(typeof latestGitHubVersion, "function");
    assertEquals(typeof latestNpmVersion, "function");
    assertEquals(typeof latestPyPiVersion, "function");
  });

  it("orders semver-like release versions", (): void => {
    assertEquals(isSemver("1.69.0"), true);
    assertEquals(isSemver("apps_v1.69.0"), false);
    assertEquals(compareVersions("1.68.0", "1.69.0") < 0, true);
    assertEquals(compareVersions("1.69.0", "1.69.0"), 0);
  });

  it("can read GitHub versions from releases", async (): Promise<void> => {
    const ghToken = Deno.env.get("GH_TOKEN");
    const gitHubToken = Deno.env.get("GITHUB_TOKEN");
    Deno.env.delete("GH_TOKEN");
    Deno.env.delete("GITHUB_TOKEN");

    try {
      await withMockedJsonFetch(
        {
          body: [
            { tag_name: "apps_v1.68.0" },
            { tag_name: "apps_v1.69.0" },
            { tag_name: "unrelated" },
          ],
          expectedUrl: "https://api.github.com/repos/oxc-project/oxc/releases?per_page=100",
        },
        async (): Promise<void> => {
          assertEquals(
            await Effect.runPromise(
              latestGitHubVersion({
                owner: "oxc-project",
                repo: "oxc",
                source: "releases",
                versionPattern: /^apps_v(?<version>\d+\.\d+\.\d+)$/u,
              }),
            ),
            "1.69.0",
          );
        },
      );
    } finally {
      if (ghToken === undefined) {
        Deno.env.delete("GH_TOKEN");
      } else {
        Deno.env.set("GH_TOKEN", ghToken);
      }
      if (gitHubToken === undefined) {
        Deno.env.delete("GITHUB_TOKEN");
      } else {
        Deno.env.set("GITHUB_TOKEN", gitHubToken);
      }
    }
  });

  it("rejects malformed npm versions at the source boundary", async (): Promise<void> => {
    await withMockedJsonFetch(
      {
        body: { "dist-tags": { latest: "01.0.0" } },
        expectedUrl: "https://registry.npmjs.org/example",
      },
      async (): Promise<void> => {
        const error = await Effect.runPromise(Effect.flip(latestNpmVersion("example")));

        assertInstanceOf(error, UpdateError);
        assertStringIncludes(error.message, "Invalid npm latest version");
      },
    );
  });

  it("rejects malformed PyPI versions at the source boundary", async (): Promise<void> => {
    await withMockedJsonFetch(
      {
        body: { info: { version: "1.0.0-" } },
        expectedUrl: "https://pypi.org/pypi/example/json",
      },
      async (): Promise<void> => {
        const error = await Effect.runPromise(Effect.flip(latestPyPiVersion("example")));

        assertInstanceOf(error, UpdateError);
        assertStringIncludes(error.message, "Invalid PyPI latest version");
      },
    );
  });
});
