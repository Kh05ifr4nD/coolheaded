import type { CommandRunner } from "coolheaded/core/commandRunner.ts";
import { Effect } from "effect";
import type { JsonClient } from "coolheaded/core/httpClient.ts";
import { fetchJsonClient } from "coolheaded/core/fetchHttpClient.ts";
import { runUpdateScript } from "coolheaded/core/updateScript.ts";
import { updateNpmTarballPackage } from "coolheaded/npm/tarball.ts";

const NPM_PACKAGE_NAME = "@jackwener/opencli";

interface UpdateDependencies {
  readonly importMetaUrl: string;
  readonly jsonClient: JsonClient;
  readonly runner: CommandRunner;
}

function updateProgram(
  args: readonly string[],
  dependencies: UpdateDependencies,
): Effect.Effect<void, Error> {
  return updateNpmTarballPackage({
    args,
    importMetaUrl: dependencies.importMetaUrl,
    jsonClient: dependencies.jsonClient,
    packageName: NPM_PACKAGE_NAME,
    runner: dependencies.runner,
    tarballBaseName: "opencli",
  });
}

async function main(args: readonly string[], dependencies: UpdateDependencies): Promise<void> {
  await Effect.runPromise(updateProgram(args, dependencies));
}

function cliProgram(args: readonly string[], runner: CommandRunner): Effect.Effect<void, Error> {
  return updateProgram(args, {
    importMetaUrl: import.meta.url,
    jsonClient: fetchJsonClient,
    runner,
  });
}

runUpdateScript(import.meta.url, cliProgram);

export { main, updateProgram };
