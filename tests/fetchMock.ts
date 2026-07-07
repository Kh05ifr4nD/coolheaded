import { assertEquals } from "@jsr/std__assert";

const OK_STATUS = 200;

interface MockJsonFetchOptions {
  readonly body: unknown;
  readonly expectedUrl: string;
  readonly status?: number;
}

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

function mockJsonFetch(options: MockJsonFetchOptions): typeof globalThis.fetch {
  return (input: FetchInput): Promise<Response> => {
    assertEquals(fetchInputUrl(input), options.expectedUrl);

    return Promise.resolve(
      globalThis.Response.json(options.body, { status: options.status ?? OK_STATUS }),
    );
  };
}

export async function withMockedJsonFetch<Result>(
  options: MockJsonFetchOptions,
  run: () => Promise<Result>,
): Promise<Result> {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = mockJsonFetch(options);

  try {
    return await run();
  } finally {
    globalThis.fetch = originalFetch;
  }
}
