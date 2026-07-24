import { CommandExitError, run } from "coolheadedCi/process.ts";
import { assertEquals, assertInstanceOf, assertRejects, assertThrows } from "@jsr/std__assert";
import { FakeCommandRunner } from "coolheadedTestSupport/commandRunner.ts";

const success = { code: 0, stderr: "", stdout: "" };

Deno.test("command runner matches environment structurally", async (): Promise<void> => {
  const runner = new FakeCommandRunner([
    {
      request: { command: ["tool", "arg"], env: { ALPHA: "1", BETA: "2" } },
      result: { code: 0, stderr: " warning \n", stdout: " value \n" },
    },
  ]);
  const result = await run(runner, ["tool", "arg"], {
    capture: true,
    env: Object.fromEntries([
      ["BETA", "2"],
      ["ALPHA", "1"],
    ]),
  });

  assertEquals(result, { code: 0, stderr: "warning", stdout: "value" });
  assertEquals(runner.calls(), [
    {
      command: ["tool", "arg"],
      env: Object.fromEntries([
        ["BETA", "2"],
        ["ALPHA", "1"],
      ]),
    },
  ]);
  runner.assertExhausted();
});

Deno.test("process wrapper owns nonzero exit policy", async (): Promise<void> => {
  const request = { command: ["tool", "fail"] } as const;
  const result = { code: 9, stderr: "raw stderr\n", stdout: "raw stdout\n" };
  const checked = new FakeCommandRunner([{ request, result }]);
  const error = await assertRejects((): Promise<unknown> => run(checked, request.command));
  assertInstanceOf(error, CommandExitError);
  assertEquals(error.request, request);
  assertEquals(error.result, result);
  checked.assertExhausted();

  const unchecked = new FakeCommandRunner([{ request, result }]);
  assertEquals(await run(unchecked, request.command, { check: false }), {
    code: 9,
    stderr: "raw stderr",
    stdout: "raw stdout",
  });
  unchecked.assertExhausted();
});

Deno.test("strict fake rejects unexpected and unconsumed calls", async (): Promise<void> => {
  const unexpected = new FakeCommandRunner([]);
  await assertRejects((): Promise<unknown> => unexpected.run({ command: ["unexpected"] }));

  const unconsumed = new FakeCommandRunner([
    { request: { command: ["remaining"] }, result: success },
  ]);
  assertThrows((): void => {
    unconsumed.assertExhausted();
  }, Error);
});
