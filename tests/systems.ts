import { SUPPORTED_SYSTEMS, SYSTEM_TARGETS } from "coolheaded/system/target.ts";
import { describe, it } from "@jsr/std__testing/bdd";
import { assertEquals } from "@jsr/std__assert";

const REPOSITORY_ROOT = new globalThis.URL("../", import.meta.url).pathname;

async function readRepositoryFile(path: string): Promise<string> {
  return await Deno.readTextFile(`${REPOSITORY_ROOT}${path}`);
}

async function fileContains(path: string, needle: string): Promise<boolean> {
  const content = await readRepositoryFile(path);
  return content.includes(needle);
}

function systemsJsonTargets(): readonly string[] {
  return SYSTEM_TARGETS.map(({ system }) => system);
}

describe("supported systems", (): void => {
  it("derives supported systems from the shared system target contract", (): void => {
    assertEquals(SUPPORTED_SYSTEMS, systemsJsonTargets());
  });

  it("keeps flake-parts systems sourced from the shared system target contract", async (): Promise<void> => {
    assertEquals(
      await fileContains("flake.nix", "builtins.readFile ./lib/ts/system/targets.json"),
      true,
    );
    assertEquals(await fileContains("flake.nix", "systems = supportedSystems;"), true);
  });

  it("keeps packageLib targets sourced from the shared system target contract", async (): Promise<void> => {
    assertEquals(
      await fileContains("lib/nix/base.nix", "builtins.readFile ../ts/system/targets.json"),
      true,
    );
    assertEquals(await fileContains("lib/nix/base.nix", "targetAttrs"), true);
  });
});
