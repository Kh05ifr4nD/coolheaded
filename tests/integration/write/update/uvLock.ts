import type { CommandRequest, CommandRunner } from "coolheaded/core/commandRunner.ts";
import type { HttpRequest, HttpResponse } from "coolheaded/core/httpClient.ts";
import {
  assertEquals,
  assertInstanceOf,
  assertRejects,
  assertStrictEquals,
} from "@jsr/std__assert";
import { Effect } from "effect";
import { FakeCommandRunner } from "coolheadedTestSupport/commandRunner.ts";
import { UpdateError } from "coolheaded/core/updateScript.ts";
import { httpJsonError } from "coolheaded/core/fetchHttpClient.ts";
import { updateVersionedNixpkgsPythonUvLock } from "coolheaded/update/uvLock.ts";

const VERSION = "1.2.3";
const COMMAND_FAILURE = 23;
const COMMAND_OK = { code: 0, stderr: "", stdout: "" };
const HTTP_OK = 200;
const NON_TEXT_BYTE = 255;
const REQUEST_TIMEOUT_MS = 30_000;
const SECOND_NON_TEXT_BYTE = 254;
const UV_LOCK = "version = 1\n";
const PIN_SENTINEL = new Uint8Array([0, NON_TEXT_BYTE, 1]);
const LOCK_SENTINEL = new Uint8Array([2, SECOND_NON_TEXT_BYTE, 3]);
const PYPROJECT = `[project]
name = "coolheaded-lock-input"
version = "0"
requires-python = ">=3.13"
dependencies = ["tool==1.2.3"]

[project.optional-dependencies]
dev = ["pytest"]
docs = ["mkdocs"]

[tool.uv.extra-build-dependencies]
tool = ["setuptools"]
`;

function dependencies(
  directory: string,
  runner: Readonly<CommandRunner>,
  latestVersion: () => Effect.Effect<string, Error> = (): Effect.Effect<string, Error> =>
    Effect.succeed(VERSION),
): Parameters<typeof updateVersionedNixpkgsPythonUvLock>[0] {
  return {
    args: [],
    latestVersion,
    pinFilePath: `${directory}/pin.json`,
    project: (version: string, pythonMinorVersion: string) => ({
      dependencies: [`tool==${version}`],
      extraBuildDependencies: { tool: ["setuptools"] },
      optionalDependencies: { dev: ["pytest"], docs: ["mkdocs"] },
      pythonMinorVersion,
    }),
    pythonPackage: "python313",
    repositoryRootPath: directory,
    runner,
    uvLockFilePath: `${directory}/uv.lock`,
  };
}

async function prepareUvLock(request: CommandRequest): Promise<void> {
  const workspacePath = request.command.at(8);
  if (workspacePath === undefined) {
    throw new TypeError("uv request requires workspace");
  }
  assertEquals(await Deno.readTextFile(`${workspacePath}/pyproject.toml`), PYPROJECT);
  await Deno.writeTextFile(`${workspacePath}/uv.lock`, UV_LOCK);
}

Deno.test("UV lock update writes exact generated project, lock, and pin", async (): Promise<void> => {
  const directory = await Deno.makeTempDir();
  await Deno.writeTextFile(`${directory}/pin.json`, '{ "version": "1.0.0" }\n');
  const runner = new FakeCommandRunner([
    {
      request: {
        command: [
          "nix",
          "eval",
          "--inputs-from",
          directory,
          "--raw",
          "nixpkgs#python313.pythonVersion",
        ],
      },
      result: { ...COMMAND_OK, stdout: "3.13\n" },
    },
    {
      assertRequest(request): void {
        const workspacePath = request.command.at(8);
        if (workspacePath === undefined) {
          throw new TypeError("uv request requires workspace");
        }
        assertEquals(request, {
          command: [
            "nix",
            "run",
            "--inputs-from",
            directory,
            "nixpkgs#uv",
            "--",
            "lock",
            "--project",
            workspacePath,
            "--no-progress",
          ],
          cwd: directory,
        });
      },
      effect: prepareUvLock,
      result: COMMAND_OK,
    },
    {
      assertRequest(request): void {
        const [, uvLockFilePath] = request.command;
        if (uvLockFilePath === undefined) {
          throw new TypeError("cat request requires lock path");
        }
        assertEquals(request, { command: ["cat", uvLockFilePath] });
        assertEquals(uvLockFilePath.endsWith("/uv.lock"), true);
      },
      result: { ...COMMAND_OK, stdout: UV_LOCK },
    },
  ]);
  try {
    await Effect.runPromise(updateVersionedNixpkgsPythonUvLock(dependencies(directory, runner)));
    assertEquals(
      await Deno.readTextFile(`${directory}/pin.json`),
      `{\n  "version": "${VERSION}"\n}\n`,
    );
    assertEquals(await Deno.readTextFile(`${directory}/uv.lock`), UV_LOCK);
    const uvRequest = runner.calls().at(1);
    const catRequest = runner.calls().at(2);
    const workspacePath = uvRequest?.command.at(8);
    assertEquals(catRequest?.command[1], `${workspacePath}/uv.lock`);
    runner.assertExhausted();
    await assertRejects(() => Deno.stat(workspacePath ?? ""));
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("UV lock update preserves targets after Python query failure", async (): Promise<void> => {
  const directory = await Deno.makeTempDir();
  await Deno.writeFile(`${directory}/pin.json`, PIN_SENTINEL);
  await Deno.writeFile(`${directory}/uv.lock`, LOCK_SENTINEL);
  const failureResult = { code: COMMAND_FAILURE, stderr: "python query failed", stdout: "" };
  const runner = new FakeCommandRunner([
    {
      request: {
        command: [
          "nix",
          "eval",
          "--inputs-from",
          directory,
          "--raw",
          "nixpkgs#python313.pythonVersion",
        ],
      },
      result: failureResult,
    },
  ]);
  try {
    const update = updateVersionedNixpkgsPythonUvLock(dependencies(directory, runner));
    const error = await Effect.runPromise(Effect.flip(update));
    assertInstanceOf(error, UpdateError);
    assertEquals(error.message, "Failed to run nix: exit 23: python query failed");
    assertEquals(await Deno.readFile(`${directory}/pin.json`), PIN_SENTINEL);
    assertEquals(await Deno.readFile(`${directory}/uv.lock`), LOCK_SENTINEL);
    assertStrictEquals(runner.observations()[0]?.result, failureResult);
    runner.assertExhausted();
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("UV lock update preserves latest JSON error identity and targets", async (): Promise<void> => {
  const directory = await Deno.makeTempDir();
  const pinSentinel = new globalThis.TextEncoder().encode('{ "version": "1.0.0" }\n');
  await Deno.writeFile(`${directory}/pin.json`, pinSentinel);
  await Deno.writeFile(`${directory}/uv.lock`, LOCK_SENTINEL);
  const request: HttpRequest = {
    headers: {},
    method: "GET",
    timeoutMs: REQUEST_TIMEOUT_MS,
    url: "https://example.test/latest",
  };
  const response: HttpResponse = {
    body: new Uint8Array(),
    headers: {},
    status: HTTP_OK,
    statusText: "OK",
    url: request.url,
  };
  const error = httpJsonError(request, response, new Error("latest JSON sentinel"));
  const runner = new FakeCommandRunner([
    {
      request: {
        command: [
          "nix",
          "eval",
          "--inputs-from",
          directory,
          "--raw",
          "nixpkgs#python313.pythonVersion",
        ],
      },
      result: { ...COMMAND_OK, stdout: "3.13\n" },
    },
  ]);
  try {
    const updateEffect = updateVersionedNixpkgsPythonUvLock(
      dependencies(directory, runner, (): Effect.Effect<string, Error> => Effect.fail(error)),
    );
    const failureEffect = Effect.flip(updateEffect);
    const failure = await Effect.runPromise(failureEffect);
    assertStrictEquals(failure, error);
    assertEquals(await Deno.readFile(`${directory}/pin.json`), pinSentinel);
    assertEquals(await Deno.readFile(`${directory}/uv.lock`), LOCK_SENTINEL);
    runner.assertExhausted();
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});
