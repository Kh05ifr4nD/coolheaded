import type {
  HttpClient,
  HttpClientError,
  HttpRequest,
  HttpResponse,
  JsonClient,
  JsonClientError,
  JsonResponse,
} from "coolheaded/core/httpClient.ts";
import type { Effect } from "effect";
import { assertEquals } from "@jsr/std__assert";

type ExpectedHttpRequest = Readonly<{
  readonly effect: () => Effect.Effect<HttpResponse, HttpClientError>;
  readonly request: HttpRequest;
}>;
type ExpectedJsonRequest = Readonly<{
  readonly effect: () => Effect.Effect<JsonResponse, JsonClientError>;
  readonly request: HttpRequest;
}>;

interface StrictHttpClient {
  readonly assertExhausted: () => void;
  readonly calls: readonly HttpRequest[];
  readonly client: HttpClient;
}

interface StrictJsonClient {
  readonly assertExhausted: () => void;
  readonly calls: readonly HttpRequest[];
  readonly client: JsonClient;
}

function strictHttpClient(expected: readonly ExpectedHttpRequest[]): StrictHttpClient {
  const queue = [...expected];
  const calls: HttpRequest[] = [];
  return {
    assertExhausted(): void {
      assertEquals(queue, []);
    },
    calls,
    client: {
      request(request: HttpRequest): Effect.Effect<HttpResponse, HttpClientError> {
        calls.push(request);
        const next = queue.shift();
        if (next === undefined) {
          throw new TypeError(`Unexpected HTTP request: ${JSON.stringify(request)}`);
        }
        assertEquals(request, next.request);
        return next.effect();
      },
    },
  };
}

function strictJsonClient(expected: readonly ExpectedJsonRequest[]): StrictJsonClient {
  const queue = [...expected];
  const calls: HttpRequest[] = [];
  return {
    assertExhausted(): void {
      assertEquals(queue, []);
    },
    calls,
    client: {
      request(request: HttpRequest): Effect.Effect<JsonResponse, JsonClientError> {
        calls.push(request);
        const next = queue.shift();
        if (next === undefined) {
          throw new TypeError(`Unexpected JSON request: ${JSON.stringify(request)}`);
        }
        assertEquals(request, next.request);
        return next.effect();
      },
    },
  };
}

export { strictHttpClient, strictJsonClient };
export type { ExpectedHttpRequest, ExpectedJsonRequest, StrictHttpClient, StrictJsonClient };
