import { compareVersions, isSemver } from "coolheaded/core/version.ts";
import { describe, it } from "@jsr/std__testing/bdd";
import {
  latestGitHubVersion,
  latestNpmVersion,
  latestPyPiVersion,
} from "coolheaded/source/version.ts";
import { Effect } from "effect";
import { assertEquals } from "@jsr/std__assert";

const OK_STATUS = 200;

interface RequestLike {
  readonly url: string;
}

interface UrlLike {
  readonly href: string;
}

type FetchInput = RequestLike | string | UrlLike;

function fetchInputUrl(input: FetchInput): string {
  if (typeof input === "string") {
    return input;
  }

  if ("href" in input) {
    return input.href;
  }

  return input.url;
}

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
    const originalFetch = globalThis.fetch;
    globalThis.fetch = ((input: FetchInput) => {
      assertEquals(
        fetchInputUrl(input),
        "https://api.github.com/repos/oxc-project/oxc/releases?per_page=100",
      );

      return Promise.resolve(
        globalThis.Response.json(
          [{ tag_name: "apps_v1.68.0" }, { tag_name: "apps_v1.69.0" }, { tag_name: "unrelated" }],
          { status: OK_STATUS },
        ),
      );
    }) as typeof globalThis.fetch;

    try {
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
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
