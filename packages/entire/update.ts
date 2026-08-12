import { fetchHttpClient, fetchJsonClient } from "coolheaded/core/fetchHttpClient.ts";
import { runUpdateScript, scriptPath } from "coolheaded/core/updateScript.ts";
import type { SupportedSystem } from "coolheaded/system/target.ts";
import { checksumManifestUpdateProgram } from "coolheaded/update/checksumManifest.ts";
import { latestGitHubVersion } from "coolheaded/source/githubVersion.ts";

const PIN_FILE_PATH = scriptPath("pin.json", import.meta.url);

const RELEASE_ASSETS = {
  "aarch64-darwin": "entire_darwin_arm64.tar.gz",
  "aarch64-linux": "entire_linux_arm64.tar.gz",
  "x86_64-linux": "entire_linux_amd64.tar.gz",
} as const satisfies Readonly<Record<SupportedSystem, string>>;

runUpdateScript(import.meta.url, (args) =>
  checksumManifestUpdateProgram({
    args,
    assetUrl: (version, asset) =>
      `https://github.com/entireio/cli/releases/download/v${version}/${asset}`,
    assets: RELEASE_ASSETS,
    httpClient: fetchHttpClient,
    latestVersion: () => latestGitHubVersion({ owner: "entireio", repo: "cli" }, fetchJsonClient),
    manifestUrl: (version) =>
      `https://github.com/entireio/cli/releases/download/v${version}/checksums.txt`,
    pinFilePath: PIN_FILE_PATH,
  }),
);
