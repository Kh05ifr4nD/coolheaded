import { describe, it } from "@jsr/std__testing/bdd";
import { SUPPORTED_SYSTEMS } from "coolheaded/system.ts";
import { assertEquals } from "@jsr/std__assert";

const REPOSITORY_ROOT = new globalThis.URL("../", import.meta.url).pathname;

async function readRepositoryFile(path: string): Promise<string> {
  return await Deno.readTextFile(`${REPOSITORY_ROOT}${path}`);
}

function nixListItems(contents: string, bindingName: string): readonly string[] {
  const pattern = new RegExp(`${bindingName}\\s*=\\s*\\[(?<items>[^\\]]*)\\]`, "u");
  const match = pattern.exec(contents);
  if (match?.groups?.["items"] === undefined) {
    throw new Error(`Missing Nix list binding: ${bindingName}`);
  }

  const items: string[] = [];
  for (const itemMatch of match.groups["items"].matchAll(/"(?<item>[^"]+)"/gu)) {
    const item = itemMatch.groups?.["item"];
    if (item === undefined) {
      throw new Error(`Malformed Nix list item in ${bindingName}`);
    }

    items.push(item);
  }

  return items;
}

describe("supported systems", (): void => {
  it("keeps flake-parts systems aligned with the TypeScript system contract", async (): Promise<void> => {
    assertEquals(nixListItems(await readRepositoryFile("flake.nix"), "systems"), SUPPORTED_SYSTEMS);
  });

  it("keeps packageLib supported systems aligned with the TypeScript system contract", async (): Promise<void> => {
    assertEquals(
      nixListItems(await readRepositoryFile("lib/nix/base.nix"), "supportedSystems"),
      SUPPORTED_SYSTEMS,
    );
  });
});
