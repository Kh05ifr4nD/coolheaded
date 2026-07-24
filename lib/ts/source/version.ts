import type { JsonClient, JsonClientError, JsonResponse } from "coolheaded/core/httpClient.ts";
import { Effect } from "effect";
import { isSemver } from "coolheaded/core/version.ts";
import { npmRegistryPackageUrl } from "coolheaded/npm/registry.ts";

const REQUEST_TIMEOUT_MS = 30_000;

type VersionSourceErrorKind = "invalidMetadata" | "missingVersion" | "pagination";

class VersionSourceError extends Error {
  public readonly kind: VersionSourceErrorKind;
  public readonly url: string;

  public constructor(kind: VersionSourceErrorKind, url: string, message: string) {
    super(message);
    this.kind = kind;
    this.name = "VersionSourceError";
    this.url = url;
  }
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function responseValue<Response extends JsonResponse>(response: Response): Response["value"] {
  return response.value;
}

function jsonValue(
  url: string,
  jsonClient: Readonly<JsonClient>,
): Effect.Effect<unknown, JsonClientError> {
  return Effect.map(
    jsonClient.request({
      headers: {},
      method: "GET",
      timeoutMs: REQUEST_TIMEOUT_MS,
      url,
    }),
    responseValue,
  );
}

function latestNpmVersion(
  packageName: string,
  jsonClient: Readonly<JsonClient>,
): Effect.Effect<string, JsonClientError | VersionSourceError> {
  const url = npmRegistryPackageUrl(packageName);

  return Effect.flatMap(
    jsonValue(url, jsonClient),
    (metadata: unknown): Effect.Effect<string, VersionSourceError> => {
      if (!isRecord(metadata)) {
        return Effect.fail(
          new VersionSourceError("invalidMetadata", url, `Invalid npm metadata for ${url}`),
        );
      }

      const distTags = metadata["dist-tags"];
      const version = isRecord(distTags) ? distTags["latest"] : undefined;
      if (typeof version !== "string" || version.length === 0) {
        return Effect.fail(
          new VersionSourceError("missingVersion", url, `Missing npm latest version for ${url}`),
        );
      }

      return isSemver(version)
        ? Effect.succeed(version)
        : Effect.fail(
            new VersionSourceError(
              "invalidMetadata",
              url,
              `Invalid npm latest version for ${url}: ${version}`,
            ),
          );
    },
  );
}

function latestPyPiVersion(
  projectName: string,
  jsonClient: Readonly<JsonClient>,
): Effect.Effect<string, JsonClientError | VersionSourceError> {
  const url = `https://pypi.org/pypi/${encodeURIComponent(projectName)}/json`;

  return Effect.flatMap(
    jsonValue(url, jsonClient),
    (metadata: unknown): Effect.Effect<string, VersionSourceError> => {
      if (!isRecord(metadata)) {
        return Effect.fail(
          new VersionSourceError("invalidMetadata", url, `Invalid PyPI metadata for ${url}`),
        );
      }

      const { info } = metadata;
      const version = isRecord(info) ? info["version"] : undefined;
      if (typeof version !== "string" || version.length === 0) {
        return Effect.fail(
          new VersionSourceError("missingVersion", url, `Missing PyPI latest version for ${url}`),
        );
      }

      return isSemver(version)
        ? Effect.succeed(version)
        : Effect.fail(
            new VersionSourceError(
              "invalidMetadata",
              url,
              `Invalid PyPI latest version for ${url}: ${version}`,
            ),
          );
    },
  );
}

export { latestNpmVersion, latestPyPiVersion, VersionSourceError };
export type { VersionSourceErrorKind };
