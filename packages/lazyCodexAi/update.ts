import { runUpdateScript, scriptPath } from "coolheaded/core/updateScript.ts";
import { Effect } from "effect";
import type { JsonClient } from "coolheaded/core/httpClient.ts";
import { fetchJsonClient } from "coolheaded/core/fetchHttpClient.ts";
import { npmPackageHashUpdateProgram } from "coolheaded/npm/packageHash.ts";

const LAZYCODEX_AI_NPM_PACKAGE_NAME = "lazycodex-ai";
const PIN_FILE_PATH = scriptPath("pin.json", import.meta.url);

function updateProgram(
  args: readonly string[],
  jsonClient: JsonClient,
): ReturnType<typeof npmPackageHashUpdateProgram> {
  return npmPackageHashUpdateProgram({
    args,
    jsonClient,
    packageName: LAZYCODEX_AI_NPM_PACKAGE_NAME,
    pinFilePath: PIN_FILE_PATH,
  });
}

async function main(args: readonly string[], jsonClient: JsonClient): Promise<void> {
  await Effect.runPromise(updateProgram(args, jsonClient));
}

function cliProgram(args: readonly string[]): ReturnType<typeof npmPackageHashUpdateProgram> {
  return updateProgram(args, fetchJsonClient);
}

runUpdateScript(import.meta.url, cliProgram);

export { main };
