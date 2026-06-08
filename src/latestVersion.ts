import { Effect } from "effect";
import { UpdateError } from "./updateScript.ts";

interface LatestGitHubVersionOptions {
  readonly owner: string;
  readonly repo: string;
  readonly versionPattern?: Readonly<RegExp>;
}

const SEMVER_PATTERN = /^(?<version>\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)$/u;

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseJsonResponse(url: string): Effect.Effect<unknown, UpdateError> {
  return Effect.tryPromise({
    catch(error: unknown): UpdateError {
      if (error instanceof UpdateError) {
        return error;
      }

      return new UpdateError(`Failed to fetch ${url}`);
    },
    async try(): Promise<unknown> {
      const response = await globalThis.fetch(url);
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

  return typeof version === "string" && SEMVER_PATTERN.test(version) ? version : undefined;
}

function semverParts(version: string): readonly number[] {
  return version
    .split(/[.+-]/u)
    .slice(0, 3)
    .map((part: string): number => Number.parseInt(part, 10));
}

function compareSemver(left: string, right: string): number {
  const leftParts = semverParts(left);
  const rightParts = semverParts(right);

  for (const index of [0, 1, 2]) {
    const diff = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (diff !== 0) {
      return diff;
    }
  }

  return left.localeCompare(right);
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
  const tagsUrl = `https://api.github.com/repos/${options.owner}/${options.repo}/tags?per_page=100`;

  return Effect.flatMap(
    parseJsonResponse(tagsUrl),
    (tags: unknown): Effect.Effect<string, Error> => {
      const versions = refNames(tags)
        .map((name: string): string | undefined => normalizeGitHubVersion(name, pattern))
        .filter((version: string | undefined): version is string => version !== undefined)
        .toSorted(compareSemver);
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
