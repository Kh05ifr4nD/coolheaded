import { describe, it } from "@jsr/std__testing/bdd";
import { assertEquals } from "@jsr/std__assert";
import { checkedFileSpec } from "coolheaded/checkFileSpec.ts";
import { join } from "@jsr/std__path";
import { serializePinJson } from "coolheaded/pinJson.ts";

type PinJsonConfig = Parameters<typeof serializePinJson>[0];

const PACKAGES_DIRECTORY_PATH = new globalThis.URL("../packages/", import.meta.url).pathname;

async function packageDirectories(): Promise<readonly string[]> {
  const entries = await Array.fromAsync(Deno.readDir(PACKAGES_DIRECTORY_PATH));

  return entries
    .filter((entry: Readonly<Deno.DirEntry>): boolean => entry.isDirectory)
    .map((entry: Readonly<Deno.DirEntry>): string => entry.name)
    .toSorted();
}

async function fileExists(path: string): Promise<boolean> {
  try {
    const stat = await Deno.stat(path);
    return stat.isFile;
  } catch (error: unknown) {
    if (error instanceof Deno.errors.NotFound) {
      return false;
    }

    throw error;
  }
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isOptionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === "string";
}

function isStringRecord(value: unknown): value is Readonly<Record<string, string>> {
  return (
    isRecord(value) &&
    Object.values(value).every((entry: unknown): boolean => typeof entry === "string")
  );
}

function isPinJsonConfig(value: unknown): value is PinJsonConfig {
  if (!isRecord(value) || typeof value["version"] !== "string") {
    return false;
  }

  return (
    isOptionalString(value["binaryVersion"]) &&
    isOptionalString(value["cargoVendorHash"]) &&
    isOptionalString(value["npmVendorHash"]) &&
    isOptionalString(value["packageHash"]) &&
    isOptionalString(value["sourceHash"]) &&
    (value["platformPackageHashes"] === undefined || isStringRecord(value["platformPackageHashes"]))
  );
}

function pinJsonHasCanonicalOrder(contents: string): boolean {
  const pin: unknown = JSON.parse(contents);
  return isPinJsonConfig(pin) ? contents === serializePinJson(pin) : false;
}

async function invalidPinOrder(name: string): Promise<string | undefined> {
  const pinPath = join(PACKAGES_DIRECTORY_PATH, name, "pin.json");
  if (!(await fileExists(pinPath))) {
    return undefined;
  }

  const contents = await Deno.readTextFile(pinPath);
  return pinJsonHasCanonicalOrder(contents) ? undefined : `${name}/pin.json`;
}

describe("package structure", (): void => {
  it("keeps git ls-files fully conformant to fileSpec.cue", async (): Promise<void> => {
    await checkedFileSpec();
  });

  it("keeps pin.json fields in canonical order", async (): Promise<void> => {
    const directoryNames = await packageDirectories();
    const invalidPins = await Promise.all(
      directoryNames.map((name: string): Promise<string | undefined> => invalidPinOrder(name)),
    );

    assertEquals(
      invalidPins.filter((pin): pin is string => pin !== undefined),
      [],
    );
  });
});
