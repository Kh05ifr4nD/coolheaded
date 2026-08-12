import { CommandStartError, denoCommandRunner } from "coolheaded/core/denoCommandRunner.ts";
import { assertEquals, assertInstanceOf, assertRejects } from "@jsr/std__assert";

Deno.test("Deno command adapter preserves cwd environment and raw output", async (): Promise<void> => {
  const cwd = await Deno.makeTempDir();
  try {
    const realCwd = await Deno.realPath(cwd);
    const result = await denoCommandRunner.run({
      command: [
        Deno.execPath(),
        "eval",
        'console.log(Deno.cwd()); console.log(Deno.env.get("OVERLAY")); console.log(Deno.env.has("PATH")); console.error("err"); Deno.exit(7)',
      ],
      cwd,
      env: { OVERLAY: "value" },
    });
    assertEquals(result, {
      code: 7,
      stderr: "err\n",
      stdout: `${realCwd}\nvalue\ntrue\n`,
    });
  } finally {
    await Deno.remove(cwd, { recursive: true });
  }
});

Deno.test("Deno command adapter wraps start failures with exact request", async (): Promise<void> => {
  const root = await Deno.makeTempDir();
  const request = {
    command: [Deno.execPath(), "eval", ""] as const,
    cwd: `${root}/missing`,
  };
  try {
    const error = await assertRejects((): Promise<unknown> => denoCommandRunner.run(request));
    assertInstanceOf(error, CommandStartError);
    assertEquals(error.request, request);
    assertInstanceOf(error.cause, Error);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});
