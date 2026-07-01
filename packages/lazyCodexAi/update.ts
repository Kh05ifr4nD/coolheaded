import { runUpdateScript, scriptPath } from "coolheaded/core/updateScript.ts";
import { Effect } from "effect";
import { npmPackageHashUpdateProgram } from "coolheaded/npm/packageHash.ts";

const LAZYCODEX_AI_NPM_PACKAGE_NAME = "lazycodex-ai";
const PIN_FILE_PATH = scriptPath("pin.json", import.meta.url);

function updateProgram(args: readonly string[]): Effect.Effect<void, Error> {
  return npmPackageHashUpdateProgram({
    args,
    packageName: LAZYCODEX_AI_NPM_PACKAGE_NAME,
    pinFilePath: PIN_FILE_PATH,
  });
}

async function main(args: readonly string[]): Promise<void> {
  await Effect.runPromise(updateProgram(args));
}

runUpdateScript(import.meta.url, updateProgram);

export { main };
