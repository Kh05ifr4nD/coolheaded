import type { HttpClient, HttpClientError, HttpResponse } from "coolheaded/core/httpClient.ts";
import { UpdateError, runUpdateScript, scriptPath } from "coolheaded/core/updateScript.ts";
import { releaseHashUpdateProgram, releaseUrlsFromTargets } from "coolheaded/update/release.ts";
import { Effect } from "effect";
import { fetchHttpClient } from "coolheaded/core/fetchHttpClient.ts";
import { isSemver } from "coolheaded/core/version.ts";

const PIN_FILE_PATH = scriptPath("pin.json", import.meta.url);
const REQUEST_TIMEOUT_MS = 30_000;
const STABLE_URL = "https://x.ai/cli/stable";
type ReleaseTargets = Parameters<typeof releaseUrlsFromTargets>[0];

interface UpdateDependencies {
  readonly httpClient: HttpClient;
  readonly pinFilePath: string;
}

const GROK_RELEASE_TARGETS = {
  "aarch64-darwin": "macos-aarch64",
  "aarch64-linux": "linux-aarch64",
  "x86_64-linux": "linux-x86_64",
} as const satisfies ReleaseTargets;

function latestVersion(
  httpClient: Readonly<HttpClient>,
): Effect.Effect<string, HttpClientError | UpdateError> {
  return Effect.flatMap(
    httpClient.request({
      headers: {},
      method: "GET",
      timeoutMs: REQUEST_TIMEOUT_MS,
      url: STABLE_URL,
    }),
    <Response extends HttpResponse>(
      response: Readonly<Response>,
    ): Effect.Effect<string, UpdateError> =>
      Effect.flatMap(
        Effect.try({
          catch: (): UpdateError => new UpdateError(`Invalid UTF-8 response from ${STABLE_URL}`),
          try: (): string =>
            new globalThis.TextDecoder("utf8", { fatal: true }).decode(response.body).trim(),
        }),
        (version: string): Effect.Effect<string, UpdateError> => {
          if (!isSemver(version)) {
            return Effect.fail(
              new UpdateError(`Invalid stable Grok version: ${JSON.stringify(version)}`),
            );
          }

          return Effect.succeed(version);
        },
      ),
  );
}

function updateProgram(
  args: readonly string[],
  dependencies: Readonly<UpdateDependencies>,
): ReturnType<
  typeof releaseHashUpdateProgram<Effect.Effect.Error<ReturnType<typeof latestVersion>>>
> {
  return releaseHashUpdateProgram({
    args,
    httpClient: dependencies.httpClient,
    latestVersion: (): ReturnType<typeof latestVersion> => latestVersion(dependencies.httpClient),
    pinFilePath: dependencies.pinFilePath,
    source: "sha256Digest",
    urlsForVersion: (version: string) =>
      releaseUrlsFromTargets(
        GROK_RELEASE_TARGETS,
        (target: string): string => `https://x.ai/cli/grok-${version}-${target}`,
      ),
  });
}

async function main(
  args: readonly string[],
  dependencies: Readonly<UpdateDependencies>,
): Promise<void> {
  await Effect.runPromise(updateProgram(args, dependencies));
}

function cliProgram(
  args: readonly string[],
): ReturnType<
  typeof releaseHashUpdateProgram<Effect.Effect.Error<ReturnType<typeof latestVersion>>>
> {
  return updateProgram(args, { httpClient: fetchHttpClient, pinFilePath: PIN_FILE_PATH });
}

runUpdateScript(import.meta.url, cliProgram);

export { main, updateProgram };
export type { UpdateDependencies };
