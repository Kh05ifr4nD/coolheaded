import { assertEquals, assertStrictEquals } from "@jsr/std__assert";
import { layoutRun } from "coolheaded/repo/layout.ts";

Deno.test("Layout CLI skips non-main imports", async (): Promise<void> => {
  let executed = false;
  assertEquals(
    await layoutRun("file:///module.ts", "file:///test.ts", (): Promise<void> => {
      executed = true;
      return Promise.resolve();
    }),
    { kind: "skipped" },
  );
  assertEquals(executed, false);
});

Deno.test("Layout CLI reports successful conformance", async (): Promise<void> => {
  assertEquals(
    await layoutRun(
      "file:///module.ts",
      "file:///module.ts",
      (): Promise<void> => Promise.resolve(),
    ),
    { kind: "passed" },
  );
});

for (const [name, failure, stderr] of [
  ["Error", new Error("failure sentinel"), "failure sentinel\n"],
  ["non-Error", { failure: true }, "[object Object]\n"],
] as const) {
  Deno.test(`Layout CLI preserves ${name} failure output`, async (): Promise<void> => {
    const outcome = await layoutRun("file:///module.ts", "file:///module.ts", (): Promise<void> => {
      const rejection = Promise.withResolvers<undefined>();
      rejection.reject(failure);
      return rejection.promise;
    });
    assertEquals(outcome, { exitCode: 1, kind: "failed", stderr });
    if (outcome.kind === "failed") {
      assertStrictEquals(outcome.exitCode, 1);
    }
  });
}
