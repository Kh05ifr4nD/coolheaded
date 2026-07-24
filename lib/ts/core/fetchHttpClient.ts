import type {
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
} from "coolheaded/core/httpClient.ts";
import { Effect } from "effect";

function httpStatusError<Response extends HttpResponse>(
  request: HttpRequest,
  response: Response,
): HttpStatusError & Readonly<{ readonly response: Response }> {
  return Object.assign(new Error(`HTTP ${response.status} from ${response.url}`), {
    _tag: "HttpStatusError",
    request,
    response,
  } as const);
}

function httpTimeoutError(request: HttpRequest): HttpTimeoutError {
  return Object.assign(new Error(`Timed out fetching ${request.url}`), {
    _tag: "HttpTimeoutError",
    request,
  } as const);
}

function httpTransportError(request: HttpRequest, cause: unknown): HttpTransportError {
  return Object.assign(new Error(`Failed to fetch ${request.url}`), {
    _tag: "HttpTransportError",
    cause,
    request,
  } as const);
}

function httpJsonError<Response extends HttpResponse>(
  request: HttpRequest,
  response: Response,
  cause: unknown,
): HttpJsonError & Readonly<{ readonly response: Response }> {
  return Object.assign(new Error(`Invalid JSON from ${response.url}`), {
    _tag: "HttpJsonError",
    cause,
    request,
    response,
  } as const);
}

function isHttpClientError(value: unknown): value is HttpClientError {
  if (!(value instanceof Error) || !("_tag" in value)) {
    return false;
  }

  return (
    value["_tag"] === "HttpStatusError" ||
    value["_tag"] === "HttpTimeoutError" ||
    value["_tag"] === "HttpTransportError"
  );
}

function responseHeaders(
  headers: Readonly<InstanceType<typeof globalThis.Headers>>,
): Readonly<Record<string, string>> {
  return Object.fromEntries(
    [...headers.entries()].map(([name, value]: readonly [string, string]) => [
      name.toLowerCase(),
      value,
    ]),
  );
}

async function fetchResponse(request: HttpRequest): Promise<HttpResponse> {
  const controller = new globalThis.AbortController();
  const deadlineCause = new Error(`Timed out fetching ${request.url}`);
  const timeout = globalThis.setTimeout((): void => {
    controller.abort(deadlineCause);
  }, request.timeoutMs);

  try {
    const response = await globalThis.fetch(request.url, {
      headers: request.headers,
      method: request.method,
      signal: controller.signal,
    });
    const httpResponse = {
      body: new Uint8Array(await response.arrayBuffer()),
      headers: responseHeaders(response.headers),
      status: response.status,
      statusText: response.statusText,
      url: response.url,
    };
    if (!response.ok) {
      throw httpStatusError(request, httpResponse);
    }

    return httpResponse;
  } catch (error: unknown) {
    if (isHttpClientError(error)) {
      throw error;
    }

    throw controller.signal.reason === deadlineCause
      ? httpTimeoutError(request)
      : httpTransportError(request, error);
  } finally {
    globalThis.clearTimeout(timeout);
  }
}

const fetchHttpClient: HttpClient = {
  request(request: HttpRequest): Effect.Effect<HttpResponse, HttpClientError> {
    return Effect.tryPromise({
      catch(error: unknown): HttpClientError {
        return isHttpClientError(error) ? error : httpTransportError(request, error);
      },
      try: (): Promise<HttpResponse> => fetchResponse(request),
    });
  },
};

function jsonClient(httpClient: HttpClient): JsonClient {
  return {
    request(request: HttpRequest): Effect.Effect<JsonResponse, JsonClientError> {
      return Effect.flatMap(
        httpClient.request(request),
        <Response extends HttpResponse>(
          response: Response,
        ): Effect.Effect<JsonResponse & Readonly<{ readonly response: Response }>, HttpJsonError> =>
          Effect.try({
            catch: (error: unknown): HttpJsonError => httpJsonError(request, response, error),
            try: (): JsonResponse & Readonly<{ readonly response: Response }> => ({
              response,
              value: JSON.parse(new globalThis.TextDecoder().decode(response.body)),
            }),
          }),
      );
    },
  };
}

const fetchJsonClient = jsonClient(fetchHttpClient);

export {
  fetchHttpClient,
  fetchJsonClient,
  httpJsonError,
  httpStatusError,
  httpTimeoutError,
  httpTransportError,
  jsonClient,
};
