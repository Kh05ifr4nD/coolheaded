import { Effect } from "effect";
import { runUpdateScript } from "coolheaded/core/updateScript.ts";
import { updateNpmTarballPackage } from "coolheaded/npm/tarball.ts";

const NPM_PACKAGE_NAME = "@z_ai/coding-helper";
const NPM_TARBALL_BASE_NAME = "coding-helper";

function updateProgram(args: readonly string[]): Effect.Effect<void, Error> {
  return updateNpmTarballPackage({
    args,
    importMetaUrl: import.meta.url,
    packageName: NPM_PACKAGE_NAME,
    tarballBaseName: NPM_TARBALL_BASE_NAME,
  });
}

async function main(args: readonly string[]): Promise<void> {
  await Effect.runPromise(updateProgram(args));
}

runUpdateScript(import.meta.url, updateProgram);

export { main };
