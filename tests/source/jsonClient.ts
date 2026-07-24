import { assertEquals, assertInstanceOf, assertStrictEquals } from "@jsr/std__assert";
import {
  httpJsonError,
  httpStatusError,
  httpTimeoutError,
  httpTransportError,
  jsonClient,
} from "coolheaded/core/fetchHttpClient.ts";
import { Effect } from "effect";
import { strictHttpClient } from "coolheadedTestSupport/httpClient.ts";

const OK_STATUS = 200;
const TIMEOUT_MS = 1000;

const REQUEST = {
  headers: {},
  method: "GET",
  timeoutMs: TIMEOUT_MS,
  url: "https://example.invalid/data",
} as const;

Deno.test("JSON client preserves response metadata with the decoded value", async (): Promise<void> => {
  const response = {
    body: new globalThis.TextEncoder().encode('{"value":1}'),
    headers: { "content-type": "application/json" },
    status: OK_STATUS,
    statusText: "OK",
    url: REQUEST.url,
  } as const;
  const fake = strictHttpClient([
    {
      effect: (): Effect.Effect<typeof response> => Effect.succeed(response),
      request: REQUEST,
    },
  ]);

  assertEquals(await Effect.runPromise(jsonClient(fake.client).request(REQUEST)), {
    response,
    value: { value: 1 },
  });
  fake.assertExhausted();
});

Deno.test("JSON client fails invalid JSON as a typed failure", async (): Promise<void> => {
  const response = {
    body: new globalThis.TextEncoder().encode("{"),
    headers: {},
    status: OK_STATUS,
    statusText: "OK",
    url: REQUEST.url,
  } as const;
  const fake = strictHttpClient([
    {
      effect: (): Effect.Effect<typeof response> => Effect.succeed(response),
      request: REQUEST,
    },
  ]);
  const exit = await Effect.runPromiseExit(jsonClient(fake.client).request(REQUEST));

  const { _tag: exitTag } = exit;
  assertEquals(exitTag, "Failure");
  if (exitTag !== "Failure") {
    throw new TypeError("Expected JSON client failure");
  }
  const { _tag: causeTag } = exit.cause;
  assertEquals(causeTag, "Fail");
  if (causeTag !== "Fail") {
    throw new TypeError("Expected typed JSON failure");
  }
  const { error } = exit.cause;
  assertInstanceOf(error, Error);
  const { _tag: errorTag } = error;
  assertEquals(errorTag, "HttpJsonError");
  if (errorTag !== "HttpJsonError") {
    throw new TypeError("Expected HttpJsonError");
  }
  assertStrictEquals(error.request, REQUEST);
  assertStrictEquals(error.response, response);
  assertInstanceOf(error.cause, SyntaxError);
});

Deno.test("JSON error construction preserves the original cause identity", (): void => {
  const cause = new SyntaxError("sentinel");
  const response = {
    body: new Uint8Array(),
    headers: {},
    status: OK_STATUS,
    statusText: "OK",
    url: REQUEST.url,
  } as const;
  const error = httpJsonError(REQUEST, response, cause);

  assertInstanceOf(error, Error);
  const { _tag } = error;
  assertEquals(_tag, "HttpJsonError");
  assertStrictEquals(error.request, REQUEST);
  assertStrictEquals(error.response, response);
  assertStrictEquals(error.cause, cause);
});

Deno.test("HTTP error factories preserve exact boundary fields", (): void => {
  const cause = new TypeError("sentinel");
  const response = {
    body: new Uint8Array(),
    headers: {},
    status: OK_STATUS,
    statusText: "OK",
    url: REQUEST.url,
  };
  const status = httpStatusError(REQUEST, response);
  const timeout = httpTimeoutError(REQUEST);
  const transport = httpTransportError(REQUEST, cause);

  for (const error of [status, timeout, transport]) {
    assertInstanceOf(error, Error);
    assertStrictEquals(error.request, REQUEST);
  }
  const { _tag: statusTag } = status;
  const { _tag: timeoutTag } = timeout;
  const { _tag: transportTag } = transport;
  assertEquals(statusTag, "HttpStatusError");
  assertStrictEquals(status.response, response);
  assertEquals(timeoutTag, "HttpTimeoutError");
  assertEquals(transportTag, "HttpTransportError");
  assertStrictEquals(transport.cause, cause);
});

Deno.test("JSON client preserves an HTTP failure object identity", async (): Promise<void> => {
  const error = httpTransportError(REQUEST, new TypeError("sentinel"));
  const fake = strictHttpClient([
    {
      effect: (): Effect.Effect<never, typeof error> => Effect.fail(error),
      request: REQUEST,
    },
  ]);
  const received = await Effect.runPromise(Effect.flip(jsonClient(fake.client).request(REQUEST)));

  assertStrictEquals(received, error);
  fake.assertExhausted();
});
