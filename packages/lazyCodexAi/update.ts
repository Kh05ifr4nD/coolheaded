import { runUpdateScript, scriptPath } from "coolheaded/core/updateScript.ts";
import { fetchJsonClient } from "coolheaded/core/fetchHttpClient.ts";
import { npmPackageHashUpdateProgram } from "coolheaded/npm/packageHash.ts";

const LAZYCODEX_AI_NPM_PACKAGE_NAME = "lazycodex-ai";
const PIN_FILE_PATH = scriptPath("pin.json", import.meta.url);

runUpdateScript(import.meta.url, (args) =>
  npmPackageHashUpdateProgram({
    args,
    jsonClient: fetchJsonClient,
    packageName: LAZYCODEX_AI_NPM_PACKAGE_NAME,
    pinFilePath: PIN_FILE_PATH,
  }),
);
