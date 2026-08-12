import { fetchHttpClient, fetchJsonClient } from "coolheaded/core/fetchHttpClient.ts";
import { runUpdateScript, scriptPath } from "coolheaded/core/updateScript.ts";
import type { SupportedSystem } from "coolheaded/system/target.ts";
import { checksumManifestUpdateProgram } from "coolheaded/update/checksumManifest.ts";
import { latestGitHubVersion } from "coolheaded/source/githubVersion.ts";

const PIN_FILE_PATH = scriptPath("pin.json", import.meta.url);

const RELEASE_ASSETS = {
  "aarch64-darwin": "codegraph-darwin-arm64.tar.gz",
  "aarch64-linux": "codegraph-linux-arm64.tar.gz",
  "x86_64-linux": "codegraph-linux-x64.tar.gz",
} as const satisfies Readonly<Record<SupportedSystem, string>>;

runUpdateScript(import.meta.url, (args) =>
  checksumManifestUpdateProgram({
    args,
    assetUrl: (version, asset) =>
      `https://github.com/colbymchenry/codegraph/releases/download/v${version}/${asset}`,
    assets: RELEASE_ASSETS,
    httpClient: fetchHttpClient,
    latestVersion: () =>
      latestGitHubVersion({ owner: "colbymchenry", repo: "codegraph" }, fetchJsonClient),
    manifestUrl: (version) =>
      `https://github.com/colbymchenry/codegraph/releases/download/v${version}/SHA256SUMS`,
    pinFilePath: PIN_FILE_PATH,
  }),
);
