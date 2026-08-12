import { assertEquals, assertRejects } from "@jsr/std__assert";
import { describe, it } from "@jsr/std__testing/bdd";

describe("temporary filesystem permissions", (): void => {
  it("allows temporary files and denies repository access", async (): Promise<void> => {
    const temporaryPath = await Deno.makeTempFile();
    try {
      await Deno.writeTextFile(temporaryPath, "temporary");
      assertEquals(await Deno.readTextFile(temporaryPath), "temporary");
    } finally {
      await Deno.remove(temporaryPath);
    }

    await assertRejects(
      (): Promise<string> => Deno.readTextFile("deno.jsonc"),
      Deno.errors.NotCapable,
    );
    await assertRejects(
      (): Promise<void> => Deno.writeTextFile(".permissionProbe", ""),
      Deno.errors.NotCapable,
    );
  });
});
