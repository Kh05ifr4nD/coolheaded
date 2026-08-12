import type { HttpRequest, JsonResponse } from "coolheaded/core/httpClient.ts";
import { assertAsyncProperty, defineReplayTarget } from "coolheadedTestSupport/fastCheck.ts";
import { assertEquals, assertInstanceOf } from "@jsr/std__assert";
import { gitHubRelease, latestGitHubVersion } from "coolheaded/source/githubVersion.ts";
import { Effect } from "effect";
import { VersionSourceError } from "coolheaded/source/version.ts";
import { calendarVersionScheme } from "coolheaded/core/version.ts";
import fc from "fast-check";
import { strictJsonClient } from "coolheadedTestSupport/httpClient.ts";

const OK_STATUS = 200;
const TIMEOUT_MS = 30_000;
const CONTRACT_OWNER = "cli";
const CONTRACT_REPOSITORY_ID = "212613049";
const CONTRACT_REPO = "cli";
const MAX_PROPERTY_PAGE = 10_000;
const MAX_REPOSITORY_ID = 999_999_999;
const PAGE_SOURCES = ["tags", "releases"] as const;
type GitHubPageSource = (typeof PAGE_SOURCES)[number];
type InvalidContinuationKind =
  | "duplicatePage"
  | "duplicatePerPage"
  | "extraQuery"
  | "foreignOrigin"
  | "fragment"
  | "insecureOrigin"
  | "invalidPage"
  | "missingPage"
  | "missingPerPage"
  | "noncanonicalId"
  | "resourceChange"
  | "userinfo"
  | "wrongPerPage"
  | "zeroId";
const INVALID_CONTINUATION_KINDS = [
  "duplicatePage",
  "duplicatePerPage",
  "extraQuery",
  "foreignOrigin",
  "fragment",
  "insecureOrigin",
  "invalidPage",
  "missingPage",
  "missingPerPage",
  "noncanonicalId",
  "resourceChange",
  "userinfo",
  "wrongPerPage",
  "zeroId",
] as const satisfies readonly InvalidContinuationKind[];
const REQUEST_HEADERS = { accept: "application/vnd.github+json" };
type ExpectedJsonRequest = Parameters<typeof strictJsonClient>[0][number];

function namedPageUrl(source: GitHubPageSource, owner = "example", repo = "tool"): string {
  return `https://api.github.com/repos/${owner}/${repo}/${source}?per_page=100`;
}

function canonicalPageUrl(
  repositoryId: string,
  source: GitHubPageSource,
  page: number,
  pageFirst = false,
): string {
  const query = pageFirst ? `page=${page}&per_page=100` : `per_page=100&page=${page}`;
  return `https://api.github.com/repositories/${repositoryId}/${source}?${query}`;
}

function versionEntries(source: GitHubPageSource, version: string): readonly unknown[] {
  return source === "releases" ? [{ tag_name: `v${version}` }] : [{ name: `v${version}` }];
}

const FIRST_URL = namedPageUrl("tags");
const RELEASES_URL = namedPageUrl("releases");
const RELEASE_URL = "https://api.github.com/repos/example/tool/releases/tags/v2.0.0";
const SECOND_URL = `${FIRST_URL}&page=2`;

function request(url: string): HttpRequest {
  return {
    headers: REQUEST_HEADERS,
    method: "GET",
    timeoutMs: TIMEOUT_MS,
    url,
  };
}

function response(
  requestUrl: string,
  value: unknown,
  link?: string,
  finalUrl: string = requestUrl,
): JsonResponse {
  return {
    response: {
      body: new globalThis.TextEncoder().encode(JSON.stringify(value)),
      headers: link === undefined ? {} : { link },
      status: OK_STATUS,
      statusText: "OK",
      url: finalUrl,
    },
    value,
  };
}

function plan(
  requestUrl: string,
  value: unknown,
  link?: string,
  finalUrl?: string,
): ExpectedJsonRequest {
  return {
    effect: (): Effect.Effect<JsonResponse> =>
      Effect.succeed(response(requestUrl, value, link, finalUrl)),
    request: request(requestUrl),
  };
}

async function sourcePaginationFailure(
  source: GitHubPageSource,
  requestUrl: string,
  link: string | undefined,
  finalUrl: string = requestUrl,
): Promise<VersionSourceError> {
  const fake = strictJsonClient([
    plan(requestUrl, versionEntries(source, "1.0.0"), link, finalUrl),
  ]);
  const error = await Effect.runPromise(
    Effect.flip(latestGitHubVersion({ owner: "example", repo: "tool", source }, fake.client)),
  );
  assertInstanceOf(error, VersionSourceError);
  assertEquals(error.kind, "pagination");
  assertEquals(fake.calls.length, 1);
  fake.assertExhausted();
  return error;
}

async function paginationFailure(
  link: string | undefined,
  finalUrl: string = FIRST_URL,
): Promise<VersionSourceError> {
  return await sourcePaginationFailure("tags", FIRST_URL, link, finalUrl);
}

function invalidContinuationUrl(
  kind: InvalidContinuationKind,
  source: GitHubPageSource,
  repositoryId: string,
  page: number,
  invalidPage: string,
): string {
  const path = `/repositories/${repositoryId}/${source}`;
  const query = `?per_page=100&page=${page}`;
  switch (kind) {
    case "duplicatePage": {
      return `https://api.github.com${path}?per_page=100&page=${page}&page=${page}`;
    }
    case "duplicatePerPage": {
      return `https://api.github.com${path}?per_page=100&per_page=100&page=${page}`;
    }
    case "extraQuery": {
      return `https://api.github.com${path}${query}&direction=asc`;
    }
    case "foreignOrigin": {
      return `https://example.com${path}${query}`;
    }
    case "fragment": {
      return `https://api.github.com${path}${query}#next`;
    }
    case "insecureOrigin": {
      return `http://api.github.com${path}${query}`;
    }
    case "invalidPage": {
      return `https://api.github.com${path}?per_page=100&page=${invalidPage}`;
    }
    case "missingPage": {
      return `https://api.github.com${path}?per_page=100`;
    }
    case "missingPerPage": {
      return `https://api.github.com${path}?page=${page}`;
    }
    case "noncanonicalId": {
      return `https://api.github.com/repositories/0${repositoryId}/${source}${query}`;
    }
    case "resourceChange": {
      const changedSource = source === "tags" ? "releases" : "tags";
      return `https://api.github.com/repositories/${repositoryId}/${changedSource}${query}`;
    }
    case "userinfo": {
      return `https://user@api.github.com${path}${query}`;
    }
    case "wrongPerPage": {
      return `https://api.github.com${path}?per_page=99&page=${page}`;
    }
    case "zeroId": {
      return `https://api.github.com/repositories/0/${source}${query}`;
    }
    default: {
      throw new TypeError("Unknown invalid continuation kind");
    }
  }
}

Deno.test("GitHub versions follow a trusted relative next page", async (): Promise<void> => {
  const fake = strictJsonClient([
    plan(FIRST_URL, [{ name: "v1.0.0" }], `<?per_page=100&page=2>; rel="next"`),
    plan(SECOND_URL, [{ name: "v2.0.0" }]),
  ]);
  assertEquals(
    await Effect.runPromise(latestGitHubVersion({ owner: "example", repo: "tool" }, fake.client)),
    "2.0.0",
  );
  fake.assertExhausted();
});

Deno.test("GitHub releases support an explicit calendar version scheme", async (): Promise<void> => {
  const fake = strictJsonClient([
    plan(RELEASES_URL, [
      { tag_name: "2026.06.09" },
      { tag_name: "2026.07.04" },
      { tag_name: "2026.07.03" },
    ]),
  ]);

  assertEquals(
    await Effect.runPromise(
      latestGitHubVersion(
        {
          owner: "example",
          repo: "tool",
          source: "releases",
          versionPattern: /^(?<version>\d{4}\.\d{2}\.\d{2})$/u,
          versionScheme: calendarVersionScheme,
        },
        fake.client,
      ),
    ),
    "2026.07.04",
  );
  fake.assertExhausted();
});

for (const source of PAGE_SOURCES) {
  Deno.test(`GitHub ${source} follow GitHub's named-to-numeric repository Link contract`, async (): Promise<void> => {
    const firstUrl = namedPageUrl(source, CONTRACT_OWNER, CONTRACT_REPO);
    const canonicalUrl = canonicalPageUrl(CONTRACT_REPOSITORY_ID, source, 2);
    const fake = strictJsonClient([
      plan(firstUrl, versionEntries(source, "1.0.0"), `<${canonicalUrl}>; rel="next"`),
      plan(canonicalUrl, versionEntries(source, "2.0.0")),
    ]);

    assertEquals(
      await Effect.runPromise(
        latestGitHubVersion({ owner: CONTRACT_OWNER, repo: CONTRACT_REPO, source }, fake.client),
      ),
      "2.0.0",
    );
    assertEquals(fake.calls.length, 2);
    fake.assertExhausted();
  });
}

const canonicalContinuationName =
  "GitHub versions follow generated canonical numeric repository continuations";
Deno.test(canonicalContinuationName, async (): Promise<void> => {
  await assertAsyncProperty(
    defineReplayTarget(
      "tests/integration/env/source/githubVersion.ts",
      canonicalContinuationName,
      undefined,
      ["GH_TOKEN", "GITHUB_TOKEN"],
    ),
    fc.asyncProperty(
      fc.constantFrom(...PAGE_SOURCES),
      fc.integer({ max: MAX_REPOSITORY_ID, min: 1 }).map(String),
      fc.integer({ max: MAX_PROPERTY_PAGE, min: 2 }),
      fc.boolean(),
      async (
        source: GitHubPageSource,
        repositoryId: string,
        page: number,
        pageFirst: boolean,
      ): Promise<void> => {
        const firstUrl = namedPageUrl(source);
        const canonicalUrl = canonicalPageUrl(repositoryId, source, page, pageFirst);
        const fake = strictJsonClient([
          plan(firstUrl, versionEntries(source, "1.0.0"), `<${canonicalUrl}>; rel="next"`),
          plan(canonicalUrl, versionEntries(source, "9.0.0")),
        ]);

        assertEquals(
          await Effect.runPromise(
            latestGitHubVersion({ owner: "example", repo: "tool", source }, fake.client),
          ),
          "9.0.0",
        );
        assertEquals(fake.calls.length, 2);
        fake.assertExhausted();
      },
    ),
  );
});

const rejectedContinuationName =
  "GitHub versions reject generated non-contract continuation capabilities";
Deno.test(rejectedContinuationName, async (): Promise<void> => {
  await assertAsyncProperty(
    defineReplayTarget(
      "tests/integration/env/source/githubVersion.ts",
      rejectedContinuationName,
      undefined,
      ["GH_TOKEN", "GITHUB_TOKEN"],
    ),
    fc.asyncProperty(
      fc.constantFrom(...PAGE_SOURCES),
      fc.integer({ max: MAX_REPOSITORY_ID, min: 1 }).map(String),
      fc.integer({ max: MAX_PROPERTY_PAGE, min: 2 }),
      fc.constantFrom("0", "1", "01", "02", "-2", "2.0", "two"),
      async (
        source: GitHubPageSource,
        repositoryId: string,
        page: number,
        invalidPage: string,
      ): Promise<void> => {
        const firstUrl = namedPageUrl(source);
        await Promise.all(
          INVALID_CONTINUATION_KINDS.map(async (kind: InvalidContinuationKind): Promise<void> => {
            const invalidUrl = invalidContinuationUrl(
              kind,
              source,
              repositoryId,
              page,
              invalidPage,
            );
            await sourcePaginationFailure(source, firstUrl, `<${invalidUrl}>; rel="next"`);
          }),
        );
      },
    ),
  );
});

for (const [name, link] of [
  ["absent Link", undefined],
  [
    "terminal non-next Link",
    `<${FIRST_URL}&page=1>; rel="prev", <${FIRST_URL}&page=1>; rel="first"`,
  ],
] as const) {
  Deno.test(`GitHub versions stop at ${name}`, async (): Promise<void> => {
    const fake = strictJsonClient([plan(FIRST_URL, [{ name: "v1.0.0" }], link)]);
    assertEquals(
      await Effect.runPromise(latestGitHubVersion({ owner: "example", repo: "tool" }, fake.client)),
      "1.0.0",
    );
    fake.assertExhausted();
  });
}

for (const [name, link] of [
  ["malformed Link", "not-a-link"],
  ["mixed malformed Link", `<${SECOND_URL}>; rel="next", invalid`],
  ["duplicate next", `<${SECOND_URL}>; rel="next", <${SECOND_URL}>; rel="next"`],
  ["cross-origin next", `<https://example.com/repos/example/tool/tags>; rel="next"`],
  ["credential next", `<https://user@api.github.com/repos/example/tool/tags>; rel="next"`],
  ["wrong-path next", `<https://api.github.com/repos/other/tool/tags>; rel="next"`],
] as const) {
  Deno.test(`GitHub versions reject ${name}`, async (): Promise<void> => {
    await paginationFailure(link);
  });
}

for (const [name, finalUrl, link] of [
  ["cross-origin final URL without Link", "https://example.com/repos/example/tool/tags", undefined],
  [
    "wrong-path final URL with terminal Link",
    "https://api.github.com/repos/other/tool/tags",
    `<${FIRST_URL}>; rel="prev"`,
  ],
] as const) {
  Deno.test(`GitHub versions reject ${name}`, async (): Promise<void> => {
    await paginationFailure(link, finalUrl);
  });
}

Deno.test("GitHub versions reject pagination cycles", async (): Promise<void> => {
  const canonicalUrl = canonicalPageUrl("123", "tags", 2);
  const fake = strictJsonClient([
    plan(FIRST_URL, [{ name: "v1.0.0" }], `<${canonicalUrl}>; rel="next"`),
    plan(canonicalUrl, [{ name: "v2.0.0" }], `<${canonicalUrl}>; rel="next"`),
  ]);
  const error = await Effect.runPromise(
    Effect.flip(latestGitHubVersion({ owner: "example", repo: "tool" }, fake.client)),
  );
  assertInstanceOf(error, VersionSourceError);
  assertEquals(error.kind, "pagination");
  assertEquals(fake.calls.length, 2);
  fake.assertExhausted();
});

Deno.test("GitHub versions reject a changed canonical repository id", async (): Promise<void> => {
  const secondUrl = canonicalPageUrl("123", "tags", 2);
  const changedRepositoryUrl = canonicalPageUrl("456", "tags", 3);
  const fake = strictJsonClient([
    plan(FIRST_URL, [{ name: "v1.0.0" }], `<${secondUrl}>; rel="next"`),
    plan(secondUrl, [{ name: "v2.0.0" }], `<${changedRepositoryUrl}>; rel="next"`),
  ]);
  const error = await Effect.runPromise(
    Effect.flip(latestGitHubVersion({ owner: "example", repo: "tool" }, fake.client)),
  );
  assertInstanceOf(error, VersionSourceError);
  assertEquals(error.kind, "pagination");
  assertEquals(fake.calls.length, 2);
  fake.assertExhausted();
});

Deno.test("GitHub versions reject pagination beyond the page limit", async (): Promise<void> => {
  const pages = Array.from({ length: 10 }, (_value: undefined, index: number): string =>
    index === 0 ? FIRST_URL : `${FIRST_URL}&page=${index + 1}`,
  );
  const fake = strictJsonClient(
    pages.map((url: string, index: number): ExpectedJsonRequest =>
      plan(url, [{ name: `v1.0.${index}` }], `<${FIRST_URL}&page=${index + 2}>; rel="next"`),
    ),
  );
  const error = await Effect.runPromise(
    Effect.flip(latestGitHubVersion({ owner: "example", repo: "tool" }, fake.client)),
  );
  assertInstanceOf(error, VersionSourceError);
  assertEquals(error.kind, "pagination");
  fake.assertExhausted();
});

Deno.test("GitHub releases select tag_name instead of name", async (): Promise<void> => {
  const fake = strictJsonClient([
    plan(RELEASES_URL, [{ name: "not-a-version", tag_name: "v2.0.0" }]),
  ]);
  assertEquals(
    await Effect.runPromise(
      latestGitHubVersion({ owner: "example", repo: "tool", source: "releases" }, fake.client),
    ),
    "2.0.0",
  );
  fake.assertExhausted();
});

Deno.test("GitHub release preserves valid metadata", async (): Promise<void> => {
  const fake = strictJsonClient([plan(RELEASE_URL, { name: "Tool 2", tag_name: "v2.0.0" })]);
  assertEquals(await Effect.runPromise(gitHubRelease("example", "tool", "v2.0.0", fake.client)), {
    name: "Tool 2",
    tagName: "v2.0.0",
  });
  fake.assertExhausted();
});

Deno.test("GitHub release rejects an untrusted final URL", async (): Promise<void> => {
  const fake = strictJsonClient([
    plan(
      RELEASE_URL,
      { name: "Tool 2", tag_name: "v2.0.0" },
      undefined,
      "https://example.com/repos/example/tool/releases/tags/v2.0.0",
    ),
  ]);
  const error = await Effect.runPromise(
    Effect.flip(gitHubRelease("example", "tool", "v2.0.0", fake.client)),
  );
  assertInstanceOf(error, VersionSourceError);
  assertEquals(error.kind, "pagination");
  fake.assertExhausted();
});
