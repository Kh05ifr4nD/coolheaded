import type { HttpRequest, JsonResponse } from "coolheaded/core/httpClient.ts";
import { assertEquals, assertInstanceOf } from "@jsr/std__assert";
import { gitHubRelease, latestGitHubVersion } from "coolheaded/source/githubVersion.ts";
import { Effect } from "effect";
import { VersionSourceError } from "coolheaded/source/version.ts";
import { strictJsonClient } from "coolheadedTestSupport/httpClient.ts";

const OK_STATUS = 200;
const TIMEOUT_MS = 30_000;
const FIRST_URL = "https://api.github.com/repos/example/tool/tags?per_page=100";
const RELEASES_URL = "https://api.github.com/repos/example/tool/releases?per_page=100";
const RELEASE_URL = "https://api.github.com/repos/example/tool/releases/tags/v2.0.0";
const SECOND_URL = `${FIRST_URL}&page=2`;
const REQUEST_HEADERS = { accept: "application/vnd.github+json" };
type ExpectedJsonRequest = Parameters<typeof strictJsonClient>[0][number];

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

async function paginationFailure(
  link: string | undefined,
  finalUrl: string = FIRST_URL,
): Promise<VersionSourceError> {
  const fake = strictJsonClient([plan(FIRST_URL, [{ name: "v1.0.0" }], link, finalUrl)]);
  const error = await Effect.runPromise(
    Effect.flip(latestGitHubVersion({ owner: "example", repo: "tool" }, fake.client)),
  );
  assertInstanceOf(error, VersionSourceError);
  assertEquals(error.kind, "pagination");
  assertEquals(fake.calls.length, 1);
  fake.assertExhausted();
  return error;
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
  await paginationFailure(`<${FIRST_URL}>; rel="next"`);
});

Deno.test("GitHub versions reject pagination beyond the page limit", async (): Promise<void> => {
  const pages = Array.from({ length: 10 }, (_value: undefined, index: number): string =>
    index === 0 ? FIRST_URL : `${FIRST_URL}&page=${index + 1}`,
  );
  const fake = strictJsonClient(
    pages.map(
      (url: string, index: number): ExpectedJsonRequest =>
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
