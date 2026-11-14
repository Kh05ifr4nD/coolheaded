import { fetchJsonClient } from "coolheaded/core/fetchHttpClient.ts";
import { parsePackageSystems } from "coolheaded/system/target.ts";
import { runUpdateScript } from "coolheaded/core/updateScript.ts";
import systems from "./systems.json" with { type: "json" };
import { updateNpmTarballPackage } from "coolheaded/npm/tarball.ts";

runUpdateScript(import.meta.url, (args, runner) =>
  updateNpmTarballPackage({
    args,
    importMetaUrl: import.meta.url,
    jsonClient: fetchJsonClient,
    packageName: "safari-mcp",
    runner,
    systems: parsePackageSystems(systems),
  }),
);
