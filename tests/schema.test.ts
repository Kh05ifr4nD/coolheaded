import { assertEquals, assertThrows } from "@jsr/std__assert";
import { describe, it } from "@jsr/std__testing/bdd";
import {
  npmHashConfigForSystems,
  npmHashesForSystems,
} from "coolheaded/npmUpdater.ts";
import {
  npmPlatformPackageVersion,
  npmRegistryPackageUrl,
  npmScopedTarballUrl,
} from "coolheaded/npmRegistry.ts";
import { Effect } from "effect";
import fc from "fast-check";
import { parsePackageHashConfig } from "coolheaded/packageConfig.ts";

const COMPLETE_HASHES = {
  "aarch64-darwin": "sha512-a",
  "aarch64-linux": "sha512-b",
  "x86_64-linux": "sha512-c",
} as const;

describe("parsePackageHashConfig", (): void => {
  it("accepts complete package pins", (): void => {
    const config = parsePackageHashConfig({
      hashes: COMPLETE_HASHES,
      version: "0.137.0",
    });

    assertEquals(config.version, "0.137.0");
    assertEquals(config.hashes["x86_64-linux"], "sha512-c");
  });

  it("rejects missing platform pins", (): void => {
    assertThrows(
      (): void => {
        parsePackageHashConfig({
          hashes: {
            "aarch64-darwin": "sha512-a",
            "aarch64-linux": "sha512-b",
          },
          version: "0.137.0",
        });
      },
      Error,
      "Missing hash for x86_64-linux",
    );
  });

  it("preserves arbitrary non-empty hashes", (): void => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1 }),
        fc.string({ minLength: 1 }),
        fc.string({ minLength: 1 }),
        (
          darwinHash: string,
          armHash: string,
          x64Hash: string,
        ): void => {
          const config = parsePackageHashConfig({
            hashes: {
              "aarch64-darwin": darwinHash,
              "aarch64-linux": armHash,
              "x86_64-linux": x64Hash,
            },
            version: "0.137.0",
          });

          assertEquals(config.hashes["aarch64-darwin"], darwinHash);
          assertEquals(config.hashes["aarch64-linux"], armHash);
          assertEquals(config.hashes["x86_64-linux"], x64Hash);
        },
      ),
    );
  });
});

describe("npm registry URL helpers", (): void => {
  it("builds scoped package tarball URLs", (): void => {
    assertEquals(
      npmScopedTarballUrl("@openai/codex", "codex", "0.137.0-linux-x64"),
      "https://registry.npmjs.org/@openai/codex/-/codex-0.137.0-linux-x64.tgz",
    );
  });

  it("encodes scoped package names", (): void => {
    assertEquals(
      npmRegistryPackageUrl("@openai/codex"),
      "https://registry.npmjs.org/@openai%2Fcodex",
    );
  });

  it("appends platform suffixes", (): void => {
    assertEquals(
      npmPlatformPackageVersion("0.137.0", "linux-x64"),
      "0.137.0-linux-x64",
    );
  });
});

describe("npmHashesForSystems", (): void => {
  it("maps platform suffixes to integrity hashes through Effect", (): void => {
    const suffixes = {
      "x86_64-linux": "linux-x64",
    } as const;

    const hashes = Effect.runSync(
      npmHashesForSystems(
        {
          versions: {
            "0.137.0-linux-x64": {
              dist: {
                integrity: "sha512-test",
              },
            },
          },
        },
        "0.137.0",
        suffixes,
      ),
    );

    assertEquals(hashes, {
      "x86_64-linux": "sha512-test",
    });
  });

  it("fails when platform metadata is missing", (): void => {
    assertThrows(
      (): void => {
        Effect.runSync(
          npmHashesForSystems(
            { versions: {} },
            "0.137.0",
            {
              "x86_64-linux": "linux-x64",
            },
          ),
        );
      },
      Error,
      "Missing npm integrity for 0.137.0-linux-x64",
    );
  });
});

describe("npmHashConfigForSystems", (): void => {
  it("keeps the requested package version in the generated config", (): void => {
    const suffixes = {
      "aarch64-darwin": "darwin-arm64",
      "aarch64-linux": "linux-arm64",
      "x86_64-linux": "linux-x64",
    } as const;

    const config = Effect.runSync(
      npmHashConfigForSystems(
        {
          versions: {
            "0.137.0-darwin-arm64": {
              dist: {
                integrity: "sha512-darwin",
              },
            },
            "0.137.0-linux-arm64": {
              dist: {
                integrity: "sha512-linux-arm",
              },
            },
            "0.137.0-linux-x64": {
              dist: {
                integrity: "sha512-linux-x64",
              },
            },
          },
        },
        "0.137.0",
        suffixes,
      ),
    );

    assertEquals(config, {
      hashes: {
        "aarch64-darwin": "sha512-darwin",
        "aarch64-linux": "sha512-linux-arm",
        "x86_64-linux": "sha512-linux-x64",
      },
      version: "0.137.0",
    });
  });
});
