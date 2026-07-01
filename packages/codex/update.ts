import { runUpdateScript, scriptPath } from "coolheaded/core/updateScript.ts";
import { Effect } from "effect";
import type { SupportedSystem } from "coolheaded/system/target.ts";
import { npmPlatformPackageHashUpdateProgram } from "coolheaded/npm/packageHash.ts";

const CODEX_NPM_PACKAGE_NAME = "@openai/codex";
const PIN_FILE_PATH = scriptPath("pin.json", import.meta.url);
const CODEX_PLATFORM_SUFFIXES = {
  "aarch64-darwin": "darwin-arm64",
  "aarch64-linux": "linux-arm64",
  "x86_64-linux": "linux-x64",
} as const satisfies Readonly<Record<SupportedSystem, string>>;

function updateProgram(args: readonly string[]): Effect.Effect<void, Error> {
  return npmPlatformPackageHashUpdateProgram({
    args,
    packageName: CODEX_NPM_PACKAGE_NAME,
    pinFilePath: PIN_FILE_PATH,
    suffixes: CODEX_PLATFORM_SUFFIXES,
  });
}

async function main(args: readonly string[]): Promise<void> {
  await Effect.runPromise(updateProgram(args));
}

runUpdateScript(import.meta.url, updateProgram);

export { main };
