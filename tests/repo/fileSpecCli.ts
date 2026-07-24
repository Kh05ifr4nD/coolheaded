import { assertEquals, assertStrictEquals } from "@jsr/std__assert";
import { fileSpecRun } from "coolheaded/repo/fileSpec.ts";

Deno.test("FileSpec CLI skips non-main imports", async (): Promise<void> => {
  let executed = false;
  assertEquals(
    await fileSpecRun("file:///module.ts", "file:///test.ts", (): Promise<void> => {
      executed = true;
      return Promise.resolve();
    }),
    { kind: "skipped" },
  );
  assertEquals(executed, false);
});

Deno.test("FileSpec CLI reports successful conformance", async (): Promise<void> => {
  assertEquals(
    await fileSpecRun(
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
  Deno.test(`FileSpec CLI preserves ${name} failure output`, async (): Promise<void> => {
    const outcome = await fileSpecRun(
      "file:///module.ts",
      "file:///module.ts",
      (): Promise<void> => {
        const rejection = Promise.withResolvers<undefined>();
        rejection.reject(failure);
        return rejection.promise;
      },
    );
    assertEquals(outcome, { exitCode: 1, kind: "failed", stderr });
    if (outcome.kind === "failed") {
      assertStrictEquals(outcome.exitCode, 1);
    }
  });
}
