import { fetchHttpClient } from "coolheaded/core/fetchHttpClient.ts";
import type { HttpClient, HttpClientError, HttpResponse } from "coolheaded/core/httpClient.ts";
import {
  readTextFile,
  runUpdateScript,
  scriptPath,
  UpdateError,
  updateNewerPinVersion,
} from "coolheaded/core/updateScript.ts";
import { calendarVersionScheme } from "coolheaded/core/version.ts";
import { writePinJson } from "coolheaded/pin/json.ts";
import { Effect } from "effect";

const INSTALLER_URL = "https://cursor.com/install";
const PIN_FILE_PATH = scriptPath("pin.json", import.meta.url);
const REQUEST_TIMEOUT_MS = 30_000;
const VERSION_PATTERN =
  /downloads\.cursor\.com\/lab\/(?<version>\d{4}\.\d{2}\.\d{2}-[0-9a-f-]+)\//u;

let latestBinaryVersion = "";

function installerVersion<Response extends HttpResponse>(
  response: Readonly<Response>,
): Effect.Effect<string, UpdateError> {
  return Effect.try({
    catch: (): UpdateError => new UpdateError(`Invalid UTF-8 response from ${INSTALLER_URL}`),
    try: (): string => new globalThis.TextDecoder("utf8", { fatal: true }).decode(response.body),
  }).pipe(
    Effect.flatMap((contents: string): Effect.Effect<string, UpdateError> => {
      const binaryVersion = VERSION_PATTERN.exec(contents)?.groups?.["version"];
      if (binaryVersion === undefined) {
        return Effect.fail(new UpdateError(`Missing Cursor CLI version from ${INSTALLER_URL}`));
      }

      latestBinaryVersion = binaryVersion;
      return Effect.succeed(binaryVersion.slice(0, 10));
    }),
  );
}

function latestVersion(
  httpClient: Readonly<HttpClient>,
): Effect.Effect<string, HttpClientError | UpdateError> {
  return Effect.flatMap(
    httpClient.request({
      headers: {},
      method: "GET",
      timeoutMs: REQUEST_TIMEOUT_MS,
      url: INSTALLER_URL,
    }),
    installerVersion,
  );
}

function updateVersion(pinPath: string): Effect.Effect<void, UpdateError> {
  if (latestBinaryVersion === "") {
    return Effect.fail(new UpdateError("Cursor CLI binary version was not resolved"));
  }

  return Effect.flatMap(
    readTextFile(pinPath),
    (contents: string): Effect.Effect<void, UpdateError> =>
      Effect.try({
        catch: (): UpdateError => new UpdateError(`Failed to parse ${pinPath}`),
        try: (): unknown => JSON.parse(contents),
      }).pipe(
        Effect.flatMap((value: unknown): Effect.Effect<void, UpdateError> => {
          if (typeof value !== "object" || value === null || Array.isArray(value)) {
            return Effect.fail(new UpdateError(`Invalid Cursor CLI pin: ${pinPath}`));
          }

          return writePinJson(pinPath, {
            binaryVersion: latestBinaryVersion,
            version: latestBinaryVersion.slice(0, 10),
          });
        }),
      ),
  );
}

function updateProgram(
  args: readonly string[],
  dependencies: Readonly<{ readonly httpClient: HttpClient; readonly pinFilePath: string }>,
): ReturnType<
  typeof updateNewerPinVersion<Effect.Effect.Error<ReturnType<typeof latestVersion>>, UpdateError>
> {
  return updateNewerPinVersion(
    args,
    (): ReturnType<typeof latestVersion> => latestVersion(dependencies.httpClient),
    dependencies.pinFilePath,
    (): Effect.Effect<void, UpdateError> => updateVersion(dependencies.pinFilePath),
    calendarVersionScheme,
  );
}

runUpdateScript(import.meta.url, (args: readonly string[]) =>
  updateProgram(args, { httpClient: fetchHttpClient, pinFilePath: PIN_FILE_PATH }),
);

export { installerVersion, latestVersion, updateProgram };
