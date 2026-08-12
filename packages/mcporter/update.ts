import { fetchJsonClient } from "coolheaded/core/fetchHttpClient.ts";
import { runUpdateScript } from "coolheaded/core/updateScript.ts";
import { updateNpmTarballPackage } from "coolheaded/npm/tarball.ts";

const NPM_PACKAGE_NAME = "mcporter";

runUpdateScript(import.meta.url, (args, runner) =>
  updateNpmTarballPackage({
    args,
    importMetaUrl: import.meta.url,
    jsonClient: fetchJsonClient,
    packageName: NPM_PACKAGE_NAME,
    runner,
  }),
);
