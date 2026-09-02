import { fetchJsonClient } from "coolheaded/core/fetchHttpClient.ts";
import { runUpdateScript } from "coolheaded/core/updateScript.ts";
import { updateNpmTarballPackage } from "coolheaded/npm/tarball.ts";

runUpdateScript(import.meta.url, (args, runner) =>
  updateNpmTarballPackage({
    args,
    importMetaUrl: import.meta.url,
    jsonClient: fetchJsonClient,
    packageName: "@zvec/zvec-grep",
    runner,
    tarballBaseName: "zvec-grep",
  }),
);
