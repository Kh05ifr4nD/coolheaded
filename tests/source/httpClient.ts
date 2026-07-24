import type { HttpClientError, HttpRequest, HttpResponse } from "coolheaded/core/httpClient.ts";
import { assertEquals, assertInstanceOf, assertStrictEquals } from "@jsr/std__assert";
import { Effect } from "effect";
import { fetchHttpClient } from "coolheaded/core/fetchHttpClient.ts";

const OK_STATUS = 200;
const NOT_FOUND_STATUS = 404;
const FOUND_STATUS = 302;
const RAW_BYTE = 255;
const SHORT_TIMEOUT_MS = 20;
const LONG_TIMEOUT_MS = 5000;
const RESPONSE_DATE = "Thu, 01 Jan 1970 00:00:00 GMT";

type IncomingRequest = Readonly<{
  readonly headers: Readonly<{
    readonly get: (name: string) => string | null;
  }>;
  readonly method: string;
  readonly signal: Readonly<AbortSignal>;
  readonly url: string;
}>;

function request(url: string, timeoutMs: number = LONG_TIMEOUT_MS): HttpRequest {
  return {
    headers: { "x-client": url.endsWith("/fast") ? "long" : "exact" },
    method: "GET",
    timeoutMs,
    url,
  };
}

async function failure(
  effect: () => Effect.Effect<HttpResponse, HttpClientError>,
): Promise<HttpClientError> {
  const exit = await Effect.runPromiseExit(effect());
  const { _tag: exitTag } = exit;
  assertEquals(exitTag, "Failure");
  if (exitTag !== "Failure") {
    throw new TypeError("Expected HTTP failure");
  }
  const { _tag: causeTag } = exit.cause;
  assertEquals(causeTag, "Fail");
  if (causeTag !== "Fail") {
    throw new TypeError("Expected typed HTTP failure");
  }
  return exit.cause.error;
}

Deno.test("fetch HTTP client preserves redirect request and raw final response", async (): Promise<void> => {
  const accepted: {
    readonly header: string | null;
    readonly method: string;
    readonly path: string;
  }[] = [];
  function handleRequest(requestValue: IncomingRequest): InstanceType<typeof globalThis.Response> {
    const path = new globalThis.URL(requestValue.url).pathname;
    accepted.push({
      header: requestValue.headers.get("x-client"),
      method: requestValue.method,
      path,
    });
    if (path === "/redirect") {
      return new globalThis.Response(null, { headers: { location: "/raw" }, status: FOUND_STATUS });
    }
    return new globalThis.Response(Uint8Array.from([0, RAW_BYTE]), {
      headers: {
        "Content-Length": "2",
        "Content-Type": "application/octet-stream",
        Date: RESPONSE_DATE,
        "X-Test": "value",
      },
      status: OK_STATUS,
    });
  }

  const server = Deno.serve({ hostname: "127.0.0.1", port: 0 }, handleRequest);
  const origin = `http://127.0.0.1:${server.addr.port}`;
  const requested = request(`${origin}/redirect`);
  try {
    assertEquals(await Effect.runPromise(fetchHttpClient.request(requested)), {
      body: Uint8Array.from([0, RAW_BYTE]),
      headers: {
        "content-length": "2",
        "content-type": "application/octet-stream",
        date: RESPONSE_DATE,
        "x-test": "value",
      },
      status: OK_STATUS,
      statusText: "OK",
      url: `${origin}/raw`,
    });
    assertEquals(accepted, [
      { header: "exact", method: "GET", path: "/redirect" },
      { header: "exact", method: "GET", path: "/raw" },
    ]);
  } finally {
    await server.shutdown();
  }
});

Deno.test("fetch HTTP client returns a typed status failure", async (): Promise<void> => {
  const server = Deno.serve(
    { hostname: "127.0.0.1", port: 0 },
    (): InstanceType<typeof globalThis.Response> =>
      new globalThis.Response("missing", {
        headers: { "x-error": "exact" },
        status: NOT_FOUND_STATUS,
      }),
  );
  const expectedRequest = request(`http://127.0.0.1:${server.addr.port}/missing`);
  try {
    const error = await failure(() => fetchHttpClient.request(expectedRequest));
    assertInstanceOf(error, Error);
    const { _tag: errorTag } = error;
    assertEquals(errorTag, "HttpStatusError");
    if (errorTag !== "HttpStatusError") {
      throw new TypeError("Expected status failure");
    }
    assertStrictEquals(error.request, expectedRequest);
    assertEquals(error.response.status, NOT_FOUND_STATUS);
    assertEquals(error.response.statusText, "Not Found");
    assertEquals(error.response.url, expectedRequest.url);
  } finally {
    await server.shutdown();
  }
});

Deno.test("fetch HTTP timeout aborts accepted request without affecting concurrent client", async (): Promise<void> => {
  const slowAccepted = Promise.withResolvers<null>();
  const slowAborted = Promise.withResolvers<null>();
  async function handleRequest(
    requestValue: IncomingRequest,
  ): Promise<InstanceType<typeof globalThis.Response>> {
    if (new globalThis.URL(requestValue.url).pathname === "/fast") {
      return new globalThis.Response("fast", { status: OK_STATUS });
    }
    slowAccepted.resolve(null);
    requestValue.signal.addEventListener(
      "abort",
      (): void => {
        slowAborted.resolve(null);
      },
      { once: true },
    );
    await slowAborted.promise;
    return new globalThis.Response("aborted", { status: OK_STATUS });
  }

  const server = Deno.serve({ hostname: "127.0.0.1", port: 0 }, handleRequest);
  const origin = `http://127.0.0.1:${server.addr.port}`;
  const shortRequest = request(`${origin}/slow`, SHORT_TIMEOUT_MS);
  const longRequest = request(`${origin}/fast`);
  try {
    const shortFailure = failure(() => fetchHttpClient.request(shortRequest));
    await slowAccepted.promise;
    const longResponse = Effect.runPromise(fetchHttpClient.request(longRequest));
    const [error, responseValue] = await Promise.all([shortFailure, longResponse]);
    await slowAborted.promise;
    const { _tag: errorTag } = error;
    assertEquals(errorTag, "HttpTimeoutError");
    assertStrictEquals(error.request, shortRequest);
    assertEquals(new globalThis.TextDecoder().decode(responseValue.body), "fast");
  } finally {
    await server.shutdown();
  }
});

Deno.test("fetch HTTP client classifies accepted TCP close as transport failure", async (): Promise<void> => {
  const listener = Deno.listen({ hostname: "127.0.0.1", port: 0, transport: "tcp" });
  let isOpen = true;
  const expectedRequest = request(`http://127.0.0.1:${listener.addr.port}/close`);
  try {
    const pendingFailure = failure(() => fetchHttpClient.request(expectedRequest));
    const connection = await listener.accept();
    connection.close();
    listener.close();
    isOpen = false;
    const error = await pendingFailure;
    assertInstanceOf(error, Error);
    const { _tag: errorTag } = error;
    assertEquals(errorTag, "HttpTransportError");
    if (errorTag !== "HttpTransportError") {
      throw new TypeError("Expected transport failure");
    }
    assertStrictEquals(error.request, expectedRequest);
    assertInstanceOf(error.cause, Error);
  } finally {
    if (isOpen) {
      listener.close();
    }
  }
});
