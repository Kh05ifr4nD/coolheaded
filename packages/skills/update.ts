import type { CommandRunner } from "coolheaded/core/commandRunner.ts";
import { Effect } from "effect";
import { runUpdateScript } from "coolheaded/core/updateScript.ts";
import { updateNpmTarballPackage } from "coolheaded/npm/tarball.ts";

const NPM_PACKAGE_NAME = "skills";

function updateProgram(args: readonly string[], runner: CommandRunner): Effect.Effect<void, Error> {
  return updateNpmTarballPackage({
    args,
    importMetaUrl: import.meta.url,
    packageName: NPM_PACKAGE_NAME,
    runner,
  });
}

async function main(args: readonly string[], runner: CommandRunner): Promise<void> {
  await Effect.runPromise(updateProgram(args, runner));
}

runUpdateScript(import.meta.url, updateProgram);

export { main };
