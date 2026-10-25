import { describe, it } from "@jsr/std__testing/bdd";
import { assertEquals } from "@jsr/std__assert";
import { supportedPackageLock } from "coolheaded/npm/lockPlatform.ts";

function lockWith(packages: Readonly<Record<string, unknown>>): string {
  return JSON.stringify({ lockfileVersion: 3, name: "demo", packages });
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function packageEntry(lock: string, path: string): Readonly<Record<string, unknown>> | undefined {
  const parsed: unknown = JSON.parse(lock);
  const packages = isRecord(parsed) ? parsed["packages"] : undefined;
  const entry = isRecord(packages) ? packages[path] : undefined;
  return isRecord(entry) ? entry : undefined;
}

function packagePaths(lock: string): readonly string[] {
  const parsed: unknown = JSON.parse(lock);
  const packages = isRecord(parsed) ? parsed["packages"] : undefined;
  return isRecord(packages) ? Object.keys(packages) : [];
}

describe("npm lock platform pruning", (): void => {
  it("drops entries that no supported platform can install", (): void => {
    const lock = lockWith({
      "": { dependencies: { native: "1.0.0" } },
      "node_modules/native": {
        optionalDependencies: {
          "native-darwin-arm64": "1.0.0",
          "native-linux-arm64-musl": "1.0.0",
          "native-win32-x64": "1.0.0",
        },
        peerDependencies: { "native-win32-x64": "1.0.0" },
        version: "1.0.0",
      },
      "node_modules/native-darwin-arm64": { cpu: ["arm64"], os: ["darwin"], version: "1.0.0" },
      "node_modules/native-linux-arm64-musl": {
        cpu: ["arm64"],
        libc: ["musl"],
        os: ["linux"],
        version: "1.0.0",
      },
      "node_modules/native-win32-x64": { cpu: ["x64"], os: ["win32"], version: "1.0.0" },
    });
    const result = supportedPackageLock(lock);
    assertEquals(packagePaths(result), [
      "",
      "node_modules/native",
      "node_modules/native-darwin-arm64",
    ]);
    assertEquals(packageEntry(result, "node_modules/native"), {
      optionalDependencies: { "native-darwin-arm64": "1.0.0" },
      peerDependencies: { "native-win32-x64": "1.0.0" },
      version: "1.0.0",
    });
  });

  it("drops dependencies reachable only through removed entries", (): void => {
    const lock = lockWith({
      "": { dependencies: { kept: "1.0.0" } },
      "node_modules/kept": { version: "1.0.0" },
      "node_modules/orphan": { version: "1.0.0" },
      "node_modules/win-only": {
        dependencies: { orphan: "1.0.0" },
        os: ["win32"],
        version: "1.0.0",
      },
    });
    assertEquals(packagePaths(supportedPackageLock(lock)), ["", "node_modules/kept"]);
  });

  it("keeps bundled entries and nested dependency paths", (): void => {
    const lock = lockWith({
      "": { dependencies: { parent: "1.0.0" } },
      "node_modules/parent": { dependencies: { child: "2.0.0" }, version: "1.0.0" },
      "node_modules/parent/node_modules/bundled": { inBundle: true, version: "1.0.0" },
      "node_modules/parent/node_modules/child": { version: "2.0.0" },
    });
    assertEquals(packagePaths(supportedPackageLock(lock)), [
      "",
      "node_modules/parent",
      "node_modules/parent/node_modules/bundled",
      "node_modules/parent/node_modules/child",
    ]);
  });

  it("returns lock text unchanged when packages are absent", (): void => {
    const lock = JSON.stringify({ lockfileVersion: 3 });
    assertEquals(supportedPackageLock(lock), lock);
  });
});
