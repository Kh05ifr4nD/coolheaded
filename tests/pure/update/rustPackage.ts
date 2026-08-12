import { assertEquals, assertInstanceOf, assertRejects } from "@jsr/std__assert";
import {
  cargoVendorHash,
  cargoVendorHashPrefetchExpression,
} from "coolheaded/update/rustPackage.ts";
import { CommandStartError } from "coolheaded/core/denoCommandRunner.ts";
import { Effect } from "effect";
import { FakeCommandRunner } from "coolheadedTestSupport/commandRunner.ts";

const source = {
  owner: "owner",
  pname: "example",
  repo: "repo",
  tag: (version: string): string => `v${version}`,
};
const root = "/repository";
const version = "1.2.3";
const sourceHash = "sha256-source=";
const command = [
  "nix",
  "build",
  "--impure",
  "--no-link",
  "--expr",
  cargoVendorHashPrefetchExpression(source, root, version, sourceHash),
] as const;

Deno.test("Rust cargo vendor hash uses injected runner and parses mismatch", async (): Promise<void> => {
  const runner = new FakeCommandRunner([
    {
      request: { command, cwd: root },
      result: { code: 1, stderr: "got: sha256-vendorHash=", stdout: "" },
    },
  ]);
  assertEquals(
    await Effect.runPromise(cargoVendorHash(source, root, version, sourceHash, runner)),
    "sha256-vendorHash=",
  );
  runner.assertExhausted();
});

Deno.test("Rust cargo vendor hash rejects success and unrelated failure", async (): Promise<void> => {
  const successful = new FakeCommandRunner([
    { request: { command, cwd: root }, result: { code: 0, stderr: "", stdout: "" } },
  ]);
  await assertRejects(() =>
    Effect.runPromise(cargoVendorHash(source, root, version, sourceHash, successful)),
  );
  successful.assertExhausted();

  const unrelated = new FakeCommandRunner([
    {
      request: { command, cwd: root },
      result: { code: 1, stderr: "unrelated failure", stdout: "" },
    },
  ]);
  await assertRejects(() =>
    Effect.runPromise(cargoVendorHash(source, root, version, sourceHash, unrelated)),
  );
  unrelated.assertExhausted();
});

Deno.test("Rust cargo vendor hash rejects malformed mismatch output", async (): Promise<void> => {
  const runner = new FakeCommandRunner([
    {
      request: { command, cwd: root },
      result: { code: 1, stderr: "got: sha256-***", stdout: "" },
    },
  ]);
  await assertRejects(() =>
    Effect.runPromise(cargoVendorHash(source, root, version, sourceHash, runner)),
  );
  runner.assertExhausted();
});

Deno.test("Rust cargo vendor hash preserves typed command start failure", async (): Promise<void> => {
  const request = { command, cwd: root } as const;
  const cause = new Error("start failed");
  const runner = new FakeCommandRunner([
    {
      effect(): never {
        throw new CommandStartError(request, cause);
      },
      request,
      result: { code: 0, stderr: "", stdout: "" },
    },
  ]);
  const error = await Effect.runPromise(
    Effect.flip(cargoVendorHash(source, root, version, sourceHash, runner)),
  );
  assertInstanceOf(error, CommandStartError);
  assertEquals(error.request, request);
  assertEquals(error.cause, cause);
  runner.assertExhausted();
});
