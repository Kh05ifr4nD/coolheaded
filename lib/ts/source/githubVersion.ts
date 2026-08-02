import type { JsonClient, JsonClientError, JsonResponse } from "coolheaded/core/httpClient.ts";
import { Effect } from "effect";
import { VersionSourceError } from "coolheaded/source/version.ts";
import { semverVersionScheme } from "coolheaded/core/version.ts";

type VersionScheme = typeof semverVersionScheme;

const MAX_GITHUB_PAGES = 10;
const REQUEST_TIMEOUT_MS = 30_000;
const CANONICAL_GITHUB_REPOSITORY_PATH = /^\/repositories\/[1-9][0-9]*\/(?<source>tags|releases)$/u;
interface LatestGitHubVersionOptions {
  readonly owner: string;
  readonly repo: string;
  readonly source?: GitHubVersionSource;
  readonly versionPattern?: Readonly<RegExp>;
  readonly versionScheme?: VersionScheme;
}
interface GitHubRelease {
  readonly name: string;
  readonly tagName: string;
}
type GitHubVersionSource = "releases" | "tags";
type GitHubVersionError = JsonClientError | VersionSourceError;
interface RuntimeEnv {
  readonly get: (name: string) => string | undefined;
}
interface RuntimeWithEnv {
  readonly env: RuntimeEnv;
}
function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isRuntimeWithEnv(value: unknown): value is RuntimeWithEnv {
  if (!isRecord(value) || !isRecord(value["env"])) {
    return false;
  }
  return typeof value["env"]["get"] === "function";
}
function envValue(name: string): string | undefined {
  const runtime = Reflect.get(globalThis, "Deno");
  return isRuntimeWithEnv(runtime) ? runtime.env.get(name) : undefined;
}
function gitHubHeaders(): Readonly<Record<string, string>> {
  const token = envValue("GH_TOKEN") ?? envValue("GITHUB_TOKEN");
  return token === undefined || token.length === 0
    ? { accept: "application/vnd.github+json" }
    : {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${token}`,
      };
}
function sourceError(
  kind: "invalidMetadata" | "missingVersion" | "pagination",
  url: string,
  message: string,
): VersionSourceError {
  return new VersionSourceError(kind, url, message);
}
function trustedPageUrl(
  candidateUrl: string,
  requestedUrl: string,
): Effect.Effect<string, VersionSourceError> {
  return candidateUrl === requestedUrl
    ? Effect.succeed(candidateUrl)
    : Effect.fail(
        sourceError("pagination", candidateUrl, `Untrusted GitHub page from ${candidateUrl}`),
      );
}
function refNames(
  value: unknown,
  source: GitHubVersionSource,
  url: string,
): Effect.Effect<readonly string[], VersionSourceError> {
  if (!Array.isArray(value)) {
    return Effect.fail(sourceError("invalidMetadata", url, `Invalid GitHub metadata from ${url}`));
  }

  const key = source === "releases" ? "tag_name" : "name";
  const names: string[] = [];
  for (const entry of value) {
    if (!isRecord(entry) || typeof entry[key] !== "string") {
      return Effect.fail(
        sourceError("invalidMetadata", url, `Invalid GitHub ${source} metadata from ${url}`),
      );
    }
    names.push(entry[key]);
  }
  return Effect.succeed(names);
}
function trustedNextUrl(
  link: string | undefined,
  responseUrl: string,
  endpointUrl: string,
  source: GitHubVersionSource,
): Effect.Effect<string | undefined, VersionSourceError> {
  if (link === undefined) {
    return Effect.succeed(void 0);
  }

  const nextTargets: string[] = [];
  for (const part of link.split(",")) {
    const match = /^\s*<(?<target>[^<>]+)>\s*;\s*rel="(?<relation>[^"]+)"\s*$/u.exec(part);
    const relation = match?.groups?.["relation"];
    const target = match?.groups?.["target"];
    if (typeof relation !== "string" || typeof target !== "string") {
      return Effect.fail(
        sourceError("pagination", responseUrl, `Invalid GitHub Link header from ${responseUrl}`),
      );
    }
    if (relation === "next") {
      nextTargets.push(target);
    }
  }
  if (nextTargets.length === 0) {
    return Effect.succeed(void 0);
  }
  if (nextTargets.length > 1) {
    return Effect.fail(
      sourceError("pagination", responseUrl, `Invalid GitHub Link header from ${responseUrl}`),
    );
  }
  const nextTarget = nextTargets.join("");

  return Effect.try({
    catch: (): VersionSourceError =>
      sourceError("pagination", responseUrl, `Invalid GitHub next page from ${responseUrl}`),
    try(): string {
      const candidate = new globalThis.URL(nextTarget, responseUrl);
      const endpoint = new globalThis.URL(endpointUrl);
      const response = new globalThis.URL(responseUrl);
      const page = candidate.searchParams.get("page");
      const canonicalPathSource = CANONICAL_GITHUB_REPOSITORY_PATH.exec(candidate.pathname)
        ?.groups?.["source"];
      const responseCanonicalPathSource = CANONICAL_GITHUB_REPOSITORY_PATH.exec(response.pathname)
        ?.groups?.["source"];
      const trustedPath =
        responseCanonicalPathSource === source
          ? candidate.pathname === response.pathname
          : response.pathname === endpoint.pathname &&
            (candidate.pathname === response.pathname || canonicalPathSource === source);
      const trustedQuery =
        page !== null &&
        /^(?:[2-9]|[1-9][0-9]+)$/u.test(page) &&
        (candidate.search === `?per_page=100&page=${page}` ||
          candidate.search === `?page=${page}&per_page=100`);
      if (
        candidate.origin !== "https://api.github.com" ||
        candidate.username.length > 0 ||
        candidate.password.length > 0 ||
        candidate.hash.length > 0 ||
        !trustedPath ||
        !trustedQuery
      ) {
        throw new Error("Untrusted GitHub continuation");
      }
      return candidate.href;
    },
  });
}
function allRefNames(
  endpointUrl: string,
  source: GitHubVersionSource,
  jsonClient: Readonly<JsonClient>,
): Effect.Effect<readonly string[], GitHubVersionError> {
  return Effect.gen(function* fetchGitHubPages(): Effect.fn.Return<
    readonly string[],
    GitHubVersionError
  > {
    const headers = gitHubHeaders();
    const names: string[] = [];
    const visited = new Set<string>();
    let url: string | undefined = endpointUrl;
    for (let page = 0; url !== undefined && page < MAX_GITHUB_PAGES; page += 1) {
      if (visited.has(url)) {
        return yield* Effect.fail(
          sourceError("pagination", url, `GitHub pagination cycle at ${url}`),
        );
      }
      visited.add(url);
      const { response, value }: JsonResponse = yield* jsonClient.request({
        headers,
        method: "GET",
        timeoutMs: REQUEST_TIMEOUT_MS,
        url,
      });
      yield* trustedPageUrl(response.url, url);
      names.push(...(yield* refNames(value, source, response.url)));
      url = yield* trustedNextUrl(response.headers["link"], response.url, endpointUrl, source);
    }
    if (url !== undefined) {
      return yield* Effect.fail(
        sourceError("pagination", url, `GitHub pagination limit exceeded at ${url}`),
      );
    }
    return names;
  });
}
function normalizedVersion(
  name: string,
  pattern: Readonly<RegExp>,
  versionScheme: VersionScheme,
): string | undefined {
  const stablePattern = new RegExp(pattern.source, pattern.flags.replaceAll(/[gy]/gu, ""));
  const version = stablePattern.exec(name)?.groups?.["version"];
  return typeof version === "string" && versionScheme.isValid(version) ? version : undefined;
}
function gitHubRelease(
  owner: string,
  repo: string,
  tag: string,
  jsonClient: Readonly<JsonClient>,
): Effect.Effect<GitHubRelease, GitHubVersionError> {
  const url = `https://api.github.com/repos/${owner}/${repo}/releases/tags/${encodeURIComponent(
    tag,
  )}`;
  return Effect.gen(function* fetchGitHubRelease(): Effect.fn.Return<
    GitHubRelease,
    GitHubVersionError
  > {
    const { response, value }: JsonResponse = yield* jsonClient.request({
      headers: gitHubHeaders(),
      method: "GET",
      timeoutMs: REQUEST_TIMEOUT_MS,
      url,
    });
    yield* trustedPageUrl(response.url, url);
    if (!isRecord(value)) {
      return yield* Effect.fail(
        sourceError("invalidMetadata", url, `Invalid GitHub release metadata from ${url}`),
      );
    }
    const { name, tag_name: tagName } = value;
    return typeof name === "string" &&
      name.length > 0 &&
      typeof tagName === "string" &&
      tagName.length > 0
      ? { name, tagName }
      : yield* Effect.fail(
          sourceError("missingVersion", url, `Missing GitHub release metadata from ${url}`),
        );
  });
}
function latestGitHubVersion(
  options: Readonly<LatestGitHubVersionOptions>,
  jsonClient: Readonly<JsonClient>,
): Effect.Effect<string, GitHubVersionError> {
  const source = options.source ?? "tags";
  const endpointUrl = `https://api.github.com/repos/${options.owner}/${options.repo}/${source}?per_page=100`;
  const pattern = options.versionPattern ?? /^v(?<version>\d+\.\d+\.\d+)$/u;
  const versionScheme = options.versionScheme ?? semverVersionScheme;
  return Effect.flatMap(
    allRefNames(endpointUrl, source, jsonClient),
    (names: readonly string[]): Effect.Effect<string, VersionSourceError> => {
      const version = names
        .map((name: string): string | undefined => normalizedVersion(name, pattern, versionScheme))
        .filter((candidate: string | undefined): candidate is string => candidate !== undefined)
        .toSorted(versionScheme.compare)
        .at(-1);
      return version === undefined
        ? Effect.fail(
            sourceError(
              "missingVersion",
              endpointUrl,
              `Missing GitHub latest version for ${options.owner}/${options.repo}`,
            ),
          )
        : Effect.succeed(version);
    },
  );
}
export { gitHubRelease, latestGitHubVersion };
export type { GitHubRelease, GitHubVersionError, GitHubVersionSource, LatestGitHubVersionOptions };
