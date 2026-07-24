import { describe, it } from "@jsr/std__testing/bdd";
import { assertRejects } from "@jsr/std__assert";

describe("pure runtime permissions", (): void => {
  it("denies filesystem, process, and network capabilities", async (): Promise<void> => {
    await assertRejects(
      (): Promise<string> => Deno.readTextFile("deno.jsonc"),
      Deno.errors.NotCapable,
    );
    await assertRejects(
      (): Promise<void> => Deno.writeTextFile(".permissionProbe", ""),
      Deno.errors.NotCapable,
    );
    await assertRejects(async (): Promise<void> => {
      await new Deno.Command("git").output();
    }, Deno.errors.NotCapable);
    await assertRejects(async (): Promise<void> => {
      await globalThis.fetch("https://example.invalid");
    }, Deno.errors.NotCapable);
  });
});
