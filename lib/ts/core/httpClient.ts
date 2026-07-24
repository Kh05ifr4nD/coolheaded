import type { Effect } from "effect";

type HttpRequest = Readonly<{
  readonly headers: Readonly<Record<string, string>>;
  readonly method: "GET";
  readonly timeoutMs: number;
  readonly url: string;
}>;

type HttpResponse = Readonly<{
  readonly body: Uint8Array;
  readonly headers: Readonly<Record<string, string>>;
  readonly status: number;
  readonly statusText: string;
  readonly url: string;
}>;

interface HttpStatusError extends Error {
  readonly _tag: "HttpStatusError";
  readonly message: string;
  readonly request: HttpRequest;
  readonly response: HttpResponse;
}

interface HttpTimeoutError extends Error {
  readonly _tag: "HttpTimeoutError";
  readonly message: string;
  readonly request: HttpRequest;
}

interface HttpTransportError extends Error {
  readonly _tag: "HttpTransportError";
  readonly cause: unknown;
  readonly message: string;
  readonly request: HttpRequest;
}

interface HttpJsonError extends Error {
  readonly _tag: "HttpJsonError";
  readonly cause: unknown;
  readonly message: string;
  readonly request: HttpRequest;
  readonly response: HttpResponse;
}

type HttpClientError = HttpStatusError | HttpTimeoutError | HttpTransportError;
type JsonClientError = HttpClientError | HttpJsonError;

interface JsonResponse {
  readonly response: HttpResponse;
  readonly value: unknown;
}

type HttpClient = Readonly<{
  readonly request: (request: HttpRequest) => Effect.Effect<HttpResponse, HttpClientError>;
}>;

type JsonClient = Readonly<{
  readonly request: (request: HttpRequest) => Effect.Effect<JsonResponse, JsonClientError>;
}>;

export type {
  HttpClient,
  HttpClientError,
  HttpJsonError,
  HttpRequest,
  HttpResponse,
  HttpStatusError,
  HttpTimeoutError,
  HttpTransportError,
  JsonClient,
  JsonClientError,
  JsonResponse,
};
