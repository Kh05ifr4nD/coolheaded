import { compareVersions, isSemver } from "./version.ts";
import { Effect } from "effect";
import { UpdateError } from "./updateScript.ts";

interface LatestGitHubVersionOptions {
  readonly owner: string;
  readonly repo: string;
  readonly source?: GitHubVersionSource;
  readonly versionPattern?: Readonly<RegExp>;
}

type GitHubVersionSource = "releases" | "tags";

interface RuntimeEnv {
  readonly get: (name: string) => string | undefined;
}

interface RuntimeWithEnv {
  readonly env: RuntimeEnv;
}

type FetchHeaders = Readonly<Record<string, string>>;

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isRuntimeWithEnv(value: unknown): value is RuntimeWithEnv {
  if (typeof value !== "object" || value === null || !("env" in value)) {
    return false;
  }

  const { env } = value;
  return typeof env === "object" && env !== null && "get" in env && typeof env.get === "function";
}

function envValue(name: string): string | undefined {
  const runtime = Reflect.get(globalThis, "Deno");

  return isRuntimeWithEnv(runtime) ? runtime.env.get(name) : undefined;
}

function gitHubHeaders(): FetchHeaders {
  const token = envValue("GH_TOKEN") ?? envValue("GITHUB_TOKEN");

  return token === undefined || token.length === 0
    ? { accept: "application/vnd.github+json" }
    : {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${token}`,
      };
}

function parseJsonResponse(
  url: string,
  headers?: FetchHeaders,
): Effect.Effect<unknown, UpdateError> {
  return Effect.tryPromise({
    catch(error: unknown): UpdateError {
      if (error instanceof UpdateError) {
        return error;
      }

      return new UpdateError(`Failed to fetch ${url}`);
    },
    async try(): Promise<unknown> {
      const response = await globalThis.fetch(url, headers === undefined ? undefined : { headers });
      if (!response.ok) {
        throw new UpdateError(`Failed to fetch ${url}: HTTP ${response.status}`);
      }

      return await response.json();
    },
  });
}

function latestNpmVersion(packageName: string): Effect.Effect<string, Error> {
  const encodedName = packageName.startsWith("@")
    ? `@${packageName
        .slice(1)
        .split("/")
        .map((part: string): string => encodeURIComponent(part))
        .join("/")}`
    : encodeURIComponent(packageName);
  const url = `https://registry.npmjs.org/${encodedName}`;

  return Effect.flatMap(
    parseJsonResponse(url),
    (metadata: unknown): Effect.Effect<string, Error> => {
      if (!isRecord(metadata)) {
        return Effect.fail(new UpdateError(`Invalid npm metadata for ${url}`));
      }

      const distTags = metadata["dist-tags"];
      const version = isRecord(distTags) ? distTags["latest"] : undefined;
      return typeof version === "string" && version.length > 0
        ? Effect.succeed(version)
        : Effect.fail(new UpdateError(`Missing npm latest version for ${url}`));
    },
  );
}

function latestPyPiVersion(projectName: string): Effect.Effect<string, Error> {
  const url = `https://pypi.org/pypi/${encodeURIComponent(projectName)}/json`;

  return Effect.flatMap(
    parseJsonResponse(url),
    (metadata: unknown): Effect.Effect<string, Error> => {
      if (!isRecord(metadata)) {
        return Effect.fail(new UpdateError(`Invalid PyPI metadata for ${url}`));
      }

      const { info } = metadata;
      const version = isRecord(info) ? info["version"] : undefined;
      return typeof version === "string" && version.length > 0
        ? Effect.succeed(version)
        : Effect.fail(new UpdateError(`Missing PyPI latest version for ${url}`));
    },
  );
}

function normalizeGitHubVersion(name: string, pattern: Readonly<RegExp>): string | undefined {
  const match = pattern.exec(name);
  const version = match?.groups?.["version"];

  return typeof version === "string" && isSemver(version) ? version : undefined;
}

function refNames(value: unknown): readonly string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((entry: unknown): readonly string[] => {
    if (!isRecord(entry)) {
      return [];
    }

    const { name: plainName, tag_name: tagName } = entry;
    const name = typeof tagName === "string" ? tagName : plainName;
    return typeof name === "string" ? [name] : [];
  });
}

function latestGitHubVersion(
  options: Readonly<LatestGitHubVersionOptions>,
): Effect.Effect<string, Error> {
  const pattern = options.versionPattern ?? /^v(?<version>\d+\.\d+\.\d+)$/u;
  const source = options.source ?? "tags";
  const endpoint = source === "releases" ? "releases" : "tags";
  const refsUrl = `https://api.github.com/repos/${options.owner}/${options.repo}/${endpoint}?per_page=100`;

  return Effect.flatMap(
    parseJsonResponse(refsUrl, gitHubHeaders()),
    (refs: unknown): Effect.Effect<string, Error> => {
      const versions = refNames(refs)
        .map((name: string): string | undefined => normalizeGitHubVersion(name, pattern))
        .filter((version: string | undefined): version is string => version !== undefined)
        .toSorted(compareVersions);
      const version = versions.at(-1);

      return typeof version === "string"
        ? Effect.succeed(version)
        : Effect.fail(
            new UpdateError(`Missing GitHub latest version for ${options.owner}/${options.repo}`),
          );
    },
  );
}

export { latestGitHubVersion, latestNpmVersion, latestPyPiVersion };
