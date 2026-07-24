import type {
  CommandRequest,
  CommandResult,
  CommandRunner,
} from "coolheaded/core/commandRunner.ts";
import { assertEquals, assertInstanceOf, assertStrictEquals } from "@jsr/std__assert";
import { Effect } from "effect";
import { FakeCommandRunner } from "coolheadedTestSupport/commandRunner.ts";
import { UpdateError } from "coolheaded/core/updateScript.ts";
import { strictJsonClient } from "coolheadedTestSupport/httpClient.ts";
import { updateProgram } from "coolheadedPackagePaseo";

const VERSION = "1.2.3";
const COMMAND_FAILURE = 23;
const COMMAND_OK = { code: 0, stderr: "", stdout: "" };
const PREFETCH_PATH = "/nix/store/prefetch-npm-deps";
const NPM_HASH = "sha256-NPM";
const SOURCE_HASH = "sha256-SOURCE";
const PACKAGE_LOCK = '{"lockfileVersion":3}\n';
const SENTINEL_BYTE = 255;
type Dependencies = Parameters<typeof updateProgram>[1];

function sourceExpression(repositoryRootPath: string): string {
  return `\nlet\n  flake = builtins.getFlake "path:${repositoryRootPath}";\n  pkgs = import flake.inputs.nixpkgs { system = builtins.currentSystem; };\nin\npkgs.fetchFromGitHub {\n  owner = "getpaseo";\n  repo = "paseo";\n  tag = "v${VERSION}";\n  hash = pkgs.lib.fakeHash;\n}\n`;
}

function dependencies(
  pinFilePath: string,
  repositoryRootPath: string,
  runner: Readonly<CommandRunner>,
): Dependencies {
  return {
    jsonClient: strictJsonClient([]).client,
    pinFilePath,
    repositoryRootPath,
    runner,
  };
}

function workspaceRunner(): CommandRunner {
  return {
    async run(request: CommandRequest): Promise<CommandResult> {
      const workspacePath = request.cwd;
      if (workspacePath === undefined) {
        throw new TypeError("tar request requires cwd");
      }
      assertEquals(request, {
        command: ["tar", "-xzf", `${workspacePath}/source.tgz`, "--strip-components=1"],
        cwd: workspacePath,
      });
      await Deno.writeTextFile(`${workspacePath}/package-lock.json`, PACKAGE_LOCK);
      return COMMAND_OK;
    },
  };
}

Deno.test("Paseo update generates npm lock hash and GitHub source pin", async (): Promise<void> => {
  const directory = await Deno.makeTempDir();
  const pinFilePath = `${directory}/pin.json`;
  const runner = new FakeCommandRunner([
    {
      request: {
        command: [
          "nix",
          "build",
          "--no-link",
          "--print-out-paths",
          "--inputs-from",
          directory,
          "nixpkgs#prefetch-npm-deps",
        ],
      },
      result: { ...COMMAND_OK, stdout: PREFETCH_PATH },
    },
    {
      assertRequest(request): void {
        const archivePath = request.command.at(-1);
        if (archivePath === undefined) {
          throw new TypeError("curl request requires output");
        }
        assertEquals(request, {
          command: [
            "curl",
            "-fsSL",
            `https://github.com/getpaseo/paseo/archive/refs/tags/v${VERSION}.tar.gz`,
            "-o",
            archivePath,
          ],
        });
        assertEquals(archivePath.endsWith("/source.tgz"), true);
      },
      result: COMMAND_OK,
    },
    {
      assertRequest(request): void {
        assertEquals(request.command[0], "tar");
        assertEquals(typeof request.cwd, "string");
      },
      runner: workspaceRunner(),
    },
    {
      assertRequest(request): void {
        const [, packageLockPath] = request.command;
        if (packageLockPath === undefined) {
          throw new TypeError("prefetch request requires package lock");
        }
        assertEquals(request, {
          command: [`${PREFETCH_PATH}/bin/prefetch-npm-deps`, packageLockPath],
        });
        assertEquals(packageLockPath.endsWith("/package-lock.json"), true);
      },
      result: { ...COMMAND_OK, stdout: NPM_HASH },
    },
    {
      request: {
        command: ["nix", "build", "--impure", "--no-link", "--expr", sourceExpression(directory)],
        cwd: directory,
      },
      result: { code: 1, stderr: `error: got: ${SOURCE_HASH}`, stdout: "" },
    },
  ]);
  try {
    await Effect.runPromise(updateProgram([VERSION], dependencies(pinFilePath, directory, runner)));
    assertEquals(
      await Deno.readTextFile(pinFilePath),
      `{\n  "version": "${VERSION}",\n  "sourceHash": "${SOURCE_HASH}",\n  "npmVendorHash": "${NPM_HASH}"\n}\n`,
    );
    const calls = runner.calls();
    assertEquals(calls[1]?.command.at(-1)?.replace("/source.tgz", ""), calls[2]?.cwd);
    assertEquals(calls[2]?.cwd, calls[3]?.command[1]?.replace("/package-lock.json", ""));
    runner.assertExhausted();
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("Paseo update preserves pin bytes when npm lock prefetch fails", async (): Promise<void> => {
  const directory = await Deno.makeTempDir();
  const pinFilePath = `${directory}/pin.json`;
  const sentinel = new Uint8Array([0, SENTINEL_BYTE, 1]);
  await Deno.writeFile(pinFilePath, sentinel);
  const failureResult = { code: COMMAND_FAILURE, stderr: "prefetch failed", stdout: "" };
  const runner = new FakeCommandRunner([
    {
      request: {
        command: [
          "nix",
          "build",
          "--no-link",
          "--print-out-paths",
          "--inputs-from",
          directory,
          "nixpkgs#prefetch-npm-deps",
        ],
      },
      result: failureResult,
    },
  ]);
  try {
    const update = updateProgram([VERSION], dependencies(pinFilePath, directory, runner));
    const error = await Effect.runPromise(Effect.flip(update));
    assertInstanceOf(error, UpdateError);
    assertEquals(error.message, "Failed to run nix: exit 23: prefetch failed");
    assertEquals(await Deno.readFile(pinFilePath), sentinel);
    assertStrictEquals(runner.observations()[0]?.result, failureResult);
    runner.assertExhausted();
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});
