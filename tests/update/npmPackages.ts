import type { CommandRequest, CommandResult } from "coolheaded/core/commandRunner.ts";
import type { HttpRequest, JsonResponse } from "coolheaded/core/httpClient.ts";
import { Effect } from "effect";
import { FakeCommandRunner } from "coolheadedTestSupport/commandRunner.ts";
import { assertEquals } from "@jsr/std__assert";
import { strictJsonClient } from "coolheadedTestSupport/httpClient.ts";
import { updateProgram as updateMcporter } from "coolheadedPackageMcporter";
import { updateProgram as updateOpenCli } from "coolheadedPackageOpenCli";

const VERSION = "1.2.3";
const COMMAND_OK: CommandResult = { code: 0, stderr: "", stdout: "" };
const PREFETCH_OUT = "/nix/store/prefetch-npm-deps";
const VENDOR_HASH = "sha256-VENDOR";
const INTEGRITY =
  "sha512-BAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBA==";
const PACKAGE_LOCK = '{"lockfileVersion":3}\n';
const HTTP_OK = 200;
const TIMEOUT_MS = 30_000;
type Program = typeof updateOpenCli;

function registryResponse(url: string): JsonResponse {
  return {
    response: {
      body: new Uint8Array(),
      headers: {},
      status: HTTP_OK,
      statusText: "OK",
      url,
    },
    value: { versions: { [VERSION]: { dist: { integrity: INTEGRITY } } } },
  };
}

function workspaceEffect(request: CommandRequest): Promise<void> | void {
  const workspacePath = request.cwd;
  if (workspacePath === undefined) {
    throw new TypeError("workspace command requires cwd");
  }
  if (request.command[0] === "tar") {
    return Deno.writeTextFile(`${workspacePath}/package.json`, '{"name":"fixture"}');
  }
  return Deno.writeTextFile(`${workspacePath}/package-lock.json`, PACKAGE_LOCK);
}

function commands(
  repositoryRootPath: string,
  tarballUrl: string,
): ConstructorParameters<typeof FakeCommandRunner>[0] {
  return [
    {
      request: {
        command: [
          "nix",
          "build",
          "--no-link",
          "--print-out-paths",
          "--inputs-from",
          repositoryRootPath,
          "nixpkgs#prefetch-npm-deps",
        ],
      },
      result: { ...COMMAND_OK, stdout: PREFETCH_OUT },
    },
    {
      assertRequest(request: CommandRequest): void {
        assertEquals(request.command.slice(0, 3), ["curl", "-fsSL", tarballUrl]);
      },
      result: COMMAND_OK,
    },
    {
      assertRequest(request: CommandRequest): void {
        assertEquals(request.command[0], "tar");
      },
      effect: workspaceEffect,
      result: COMMAND_OK,
    },
    {
      assertRequest(request: CommandRequest): void {
        assertEquals(request.command.slice(0, 6), [
          "nix",
          "shell",
          "--inputs-from",
          repositoryRootPath,
          "nixpkgs#nodejs",
          "-c",
        ]);
      },
      effect: workspaceEffect,
      result: COMMAND_OK,
    },
    {
      assertRequest(request: CommandRequest): void {
        assertEquals(request.command[0], `${PREFETCH_OUT}/bin/prefetch-npm-deps`);
      },
      result: { ...COMMAND_OK, stdout: VENDOR_HASH },
    },
  ];
}

async function checkPackage(
  program: Program,
  packageName: string,
  tarballName: string,
): Promise<void> {
  const directory = await Deno.makeTempDir();
  const packageDirectory = `${directory}/packages/fixture`;
  const repositoryRootPath = `${directory}/`;
  const registryUrl = `https://registry.npmjs.org/${encodeURIComponent(packageName)}`;
  const tarballUrl = `https://registry.npmjs.org/${packageName}/-/${tarballName}-${VERSION}.tgz`;
  await Deno.mkdir(packageDirectory, { recursive: true });
  const runner = new FakeCommandRunner(commands(repositoryRootPath, tarballUrl));
  const request: HttpRequest = {
    headers: {},
    method: "GET",
    timeoutMs: TIMEOUT_MS,
    url: registryUrl,
  };
  const json = strictJsonClient([
    {
      effect: (): Effect.Effect<JsonResponse> => Effect.succeed(registryResponse(registryUrl)),
      request,
    },
  ]);
  try {
    await Effect.runPromise(
      program([VERSION], {
        importMetaUrl: `file://${packageDirectory}/update.ts`,
        jsonClient: json.client,
        runner,
      }),
    );
    assertEquals(await Deno.readTextFile(`${packageDirectory}/package-lock.json`), PACKAGE_LOCK);
    assertEquals(JSON.parse(await Deno.readTextFile(`${packageDirectory}/pin.json`)), {
      npmVendorHash: VENDOR_HASH,
      platformPackageHashes: {
        "aarch64-darwin": INTEGRITY,
        "aarch64-linux": INTEGRITY,
        "x86_64-linux": INTEGRITY,
      },
      version: VERSION,
    });
    runner.assertExhausted();
    json.assertExhausted();
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
}

Deno.test("OpenCLI updater uses the scoped package and opencli tarball", async (): Promise<void> => {
  await checkPackage(updateOpenCli, "@jackwener/opencli", "opencli");
});

Deno.test("mcporter updater uses its npm package and tarball", async (): Promise<void> => {
  await checkPackage(updateMcporter, "mcporter", "mcporter");
});
