import { fetchHttpClient, fetchJsonClient } from "coolheaded/core/fetchHttpClient.ts";
import {
  requestedOrLatestVersion,
  runUpdateScript,
  scriptPath
} from "coolheaded/core/updateScript.ts";
import { Effect } from "effect";
import type { SupportedSystem } from "coolheaded/system/target.ts";
import { checksumManifestUpdateProgram } from "coolheaded/update/checksumManifest.ts";
import { latestGitHubVersion } from "coolheaded/source/githubVersion.ts";

const PIN_FILE_PATH = scriptPath("pin.json", import.meta.url);
const RELEASE_URL = "https://github.com/vshulcz/deja-vu/releases/download";

runUpdateScript(import.meta.url, (args) =>
  Effect.flatMap(
    requestedOrLatestVersion(args, () =>
      latestGitHubVersion({ owner: "vshulcz", repo: "deja-vu" }, fetchJsonClient)
    ),
    (version) =>
      checksumManifestUpdateProgram({
        args,
        assetUrl: (releaseVersion, asset) => `${RELEASE_URL}/v${releaseVersion}/${asset}`,
        assets: {
          "aarch64-darwin": `deja-vu_${version}_darwin_arm64.tar.gz`,
          "aarch64-linux": `deja-vu_${version}_linux_arm64.tar.gz`,
          "x86_64-linux": `deja-vu_${version}_linux_amd64.tar.gz`
        } satisfies Readonly<Partial<Record<SupportedSystem, string>>>,
        httpClient: fetchHttpClient,
        latestVersion: () => Effect.succeed(version),
        manifestUrl: (releaseVersion) => `${RELEASE_URL}/v${releaseVersion}/checksums.txt`,
        pinFilePath: PIN_FILE_PATH
      })
  )
);
