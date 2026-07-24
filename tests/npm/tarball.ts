import type { CommandRequest, CommandResult } from "coolheaded/core/commandRunner.ts";
import type { HttpRequest, JsonResponse } from "coolheaded/core/httpClient.ts";
import { assertEquals, assertInstanceOf, assertRejects } from "@jsr/std__assert";
import { Effect } from "effect";
import { FakeCommandRunner } from "coolheadedTestSupport/commandRunner.ts";
import { strictJsonClient } from "coolheadedTestSupport/httpClient.ts";
import { updateNpmTarballPackage } from "coolheaded/npm/tarball.ts";

const VERSION = "1.2.3";
const PACKAGE_NAME = "@scope/example";
const COMMAND_OK: CommandResult = { code: 0, stderr: "", stdout: "" };
const HTTP_OK = 200;
const NON_TEXT_BYTE = 255;
const REQUEST_TIMEOUT_MS = 30_000;
const SECOND_NON_TEXT_BYTE = 254;
const PREFETCH_OUT = "/nix/store/prefetch-npm-deps";
const VENDOR_HASH = "sha256-VENDOR";
const INTEGRITY =
  "sha512-BAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBA==";
const PACKAGE_LOCK = '{"lockfileVersion":3}\n';
const PIN_SENTINEL = new Uint8Array([0, NON_TEXT_BYTE, 1]);
const LOCK_SENTINEL = new Uint8Array([2, SECOND_NON_TEXT_BYTE, 3]);
const REGISTRY_URL = "https://registry.npmjs.org/%40scope%2Fexample";
const REGISTRY_REQUEST: HttpRequest = {
  headers: {},
  method: "GET",
  timeoutMs: REQUEST_TIMEOUT_MS,
  url: REGISTRY_URL,
};

function response(): JsonResponse {
  return {
    response: {
      body: new Uint8Array(),
      headers: {},
      status: HTTP_OK,
      statusText: "OK",
      url: REGISTRY_URL,
    },
    value: { versions: { [VERSION]: { dist: { integrity: INTEGRITY } } } },
  };
}

function workspaceEffect(
  packageJson: string,
  packageLock?: string,
): (request: CommandRequest) => Promise<void> {
  return async (request: CommandRequest): Promise<void> => {
    const workspacePath = request.cwd;
    if (workspacePath === undefined) {
      throw new TypeError("workspace request requires cwd");
    }
    if (request.command[0] === "tar") {
      await Deno.writeTextFile(`${workspacePath}/package.json`, packageJson);
    } else if (packageLock !== undefined) {
      assertEquals(
        await Deno.readTextFile(`${workspacePath}/package.json`),
        `{\n  "name": "example"\n}\n`,
      );
      await Deno.writeTextFile(`${workspacePath}/package-lock.json`, packageLock);
    }
  };
}

function requests(
  repositoryRootPath: string,
  packageJson: string,
  packageLock?: string,
): readonly ConstructorParameters<typeof FakeCommandRunner>[0][number][] {
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
      assertRequest(request): void {
        const archivePath = request.command.at(-1);
        if (archivePath === undefined) {
          throw new TypeError("curl request requires archive path");
        }
        assertEquals(request, {
          command: [
            "curl",
            "-fsSL",
            `https://registry.npmjs.org/${PACKAGE_NAME}/-/example-${VERSION}.tgz`,
            "-o",
            archivePath,
          ],
        });
        assertEquals(archivePath.endsWith("/package.tgz"), true);
      },
      result: COMMAND_OK,
    },
    {
      assertRequest(request): void {
        const workspacePath = request.cwd;
        if (workspacePath === undefined) {
          throw new TypeError("tar request requires cwd");
        }
        assertEquals(request, {
          command: ["tar", "-xzf", `${workspacePath}/package.tgz`, "--strip-components=1"],
          cwd: workspacePath,
        });
      },
      effect: workspaceEffect(packageJson),
      result: COMMAND_OK,
    },
    ...(packageLock === undefined
      ? []
      : [
          {
            assertRequest(request: CommandRequest): void {
              const workspacePath = request.cwd;
              if (workspacePath === undefined) {
                throw new TypeError("npm request requires cwd");
              }
              assertEquals(request, {
                command: [
                  "nix",
                  "shell",
                  "--inputs-from",
                  repositoryRootPath,
                  "nixpkgs#nodejs",
                  "-c",
                  "npm",
                  "install",
                  "--package-lock-only",
                  "--ignore-scripts",
                  "--omit=dev",
                  "--no-audit",
                  "--no-fund",
                  "--silent",
                ],
                cwd: workspacePath,
              });
            },
            effect: workspaceEffect(packageJson, packageLock),
            result: COMMAND_OK,
          },
          {
            assertRequest(request: CommandRequest): void {
              const [, packageLockPath] = request.command;
              if (packageLockPath === undefined) {
                throw new TypeError("prefetch request requires package lock");
              }
              assertEquals(request, {
                command: [`${PREFETCH_OUT}/bin/prefetch-npm-deps`, packageLockPath],
              });
              assertEquals(packageLockPath.endsWith("/package-lock.json"), true);
            },
            result: { ...COMMAND_OK, stdout: VENDOR_HASH },
          },
        ]),
  ];
}

Deno.test("npm tarball update writes sanitized lock and exact pin", async (): Promise<void> => {
  const directory = await Deno.makeTempDir();
  const packageDirectory = `${directory}/packages/example`;
  const repositoryRootPath = `${directory}/`;
  const packageJson = '{"name":"example","scripts":{"build":"false"},"devDependencies":{"x":"1"}}';
  await Deno.mkdir(packageDirectory, { recursive: true });
  const runner = new FakeCommandRunner(requests(repositoryRootPath, packageJson, PACKAGE_LOCK));
  const json = strictJsonClient([
    {
      effect: (): Effect.Effect<ReturnType<typeof response>> => Effect.succeed(response()),
      request: REGISTRY_REQUEST,
    },
  ]);
  try {
    await Effect.runPromise(
      updateNpmTarballPackage({
        args: [VERSION],
        importMetaUrl: `file://${packageDirectory}/update.ts`,
        jsonClient: json.client,
        packageName: PACKAGE_NAME,
        runner,
        tarballBaseName: "example",
      }),
    );
    assertEquals(await Deno.readTextFile(`${packageDirectory}/package-lock.json`), PACKAGE_LOCK);
    assertEquals(
      await Deno.readTextFile(`${packageDirectory}/pin.json`),
      `{\n  "version": "${VERSION}",\n  "platformPackageHashes": {\n    "aarch64-darwin": "${INTEGRITY}",\n    "aarch64-linux": "${INTEGRITY}",\n    "x86_64-linux": "${INTEGRITY}"\n  },\n  "npmVendorHash": "${VENDOR_HASH}"\n}\n`,
    );
    const workspacePath = runner.calls()[2]?.cwd;
    assertEquals(runner.calls()[3]?.cwd, workspacePath);
    assertEquals(runner.calls()[4]?.command[1], `${workspacePath}/package-lock.json`);
    runner.assertExhausted();
    json.assertExhausted();
    await assertRejects(() => Deno.stat(workspacePath ?? ""));
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("npm tarball update preserves targets after invalid package JSON", async (): Promise<void> => {
  const directory = await Deno.makeTempDir();
  const packageDirectory = `${directory}/packages/example`;
  const repositoryRootPath = `${directory}/`;
  await Deno.mkdir(packageDirectory, { recursive: true });
  await Deno.writeFile(`${packageDirectory}/pin.json`, PIN_SENTINEL);
  await Deno.writeFile(`${packageDirectory}/package-lock.json`, LOCK_SENTINEL);
  const runner = new FakeCommandRunner(requests(repositoryRootPath, "{"));
  const json = strictJsonClient([
    {
      effect: (): Effect.Effect<JsonResponse> => Effect.succeed(response()),
      request: REGISTRY_REQUEST,
    },
  ]);
  try {
    const error = await Effect.runPromise(
      Effect.flip(
        updateNpmTarballPackage({
          args: [VERSION],
          importMetaUrl: `file://${packageDirectory}/update.ts`,
          jsonClient: json.client,
          packageName: PACKAGE_NAME,
          runner,
          tarballBaseName: "example",
        }),
      ),
    );
    assertInstanceOf(error, SyntaxError);
    assertEquals(await Deno.readFile(`${packageDirectory}/pin.json`), PIN_SENTINEL);
    assertEquals(await Deno.readFile(`${packageDirectory}/package-lock.json`), LOCK_SENTINEL);
    const workspacePath = runner.calls()[2]?.cwd;
    runner.assertExhausted();
    json.assertExhausted();
    await assertRejects(() => Deno.stat(workspacePath ?? ""));
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});
