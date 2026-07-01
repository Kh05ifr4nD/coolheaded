import { assertEquals, assertRejects, assertThrows } from "@jsr/std__assert";
import { describe, it } from "@jsr/std__testing/bdd";
import { hexSha256ToSRI, releaseUrlsFromTargets } from "coolheaded/releaseUpdater.ts";
import { npmHashConfigForSystems, npmHashesForSystems } from "coolheaded/npmUpdater.ts";
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
      platformPackageHashes: COMPLETE_HASHES,
      version: "0.137.0",
    });

    assertEquals(config.version, "0.137.0");
    assertEquals(config.platformPackageHashes["x86_64-linux"], "sha512-c");
  });

  it("accepts package pins with a distinct binary version", (): void => {
    const config = parsePackageHashConfig({
      binaryVersion: "0.54.0",
      platformPackageHashes: COMPLETE_HASHES,
      version: "1.69.0",
    });

    assertEquals(config.binaryVersion, "0.54.0");
    assertEquals(config.version, "1.69.0");
  });

  it("rejects invalid binary versions", (): void => {
    assertThrows(
      (): void => {
        parsePackageHashConfig({
          binaryVersion: "",
          platformPackageHashes: COMPLETE_HASHES,
          version: "1.69.0",
        });
      },
      Error,
      "binaryVersion must be a non-empty string",
    );
  });

  it("rejects missing platform pins", (): void => {
    assertThrows(
      (): void => {
        parsePackageHashConfig({
          platformPackageHashes: {
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
        (darwinHash: string, armHash: string, x64Hash: string): void => {
          const config = parsePackageHashConfig({
            platformPackageHashes: {
              "aarch64-darwin": darwinHash,
              "aarch64-linux": armHash,
              "x86_64-linux": x64Hash,
            },
            version: "0.137.0",
          });

          assertEquals(config.platformPackageHashes["aarch64-darwin"], darwinHash);
          assertEquals(config.platformPackageHashes["aarch64-linux"], armHash);
          assertEquals(config.platformPackageHashes["x86_64-linux"], x64Hash);
        },
      ),
    );
  });
});

describe("npm registry URL helpers", (): void => {
  it("builds scoped package tarball URLs", (): void => {
    assertEquals(
      npmScopedTarballUrl("@scope/example", "example", "0.137.0-linux-x64"),
      "https://registry.npmjs.org/@scope/example/-/example-0.137.0-linux-x64.tgz",
    );
  });

  it("encodes scoped package names", (): void => {
    assertEquals(
      npmRegistryPackageUrl("@scope/example"),
      "https://registry.npmjs.org/%40scope%2Fexample",
    );
  });

  it("encodes every path separator in registry metadata URLs", (): void => {
    assertEquals(
      npmRegistryPackageUrl("@scope/name/extra"),
      "https://registry.npmjs.org/%40scope%2Fname%2Fextra",
    );
  });

  it("appends platform suffixes", (): void => {
    assertEquals(npmPlatformPackageVersion("0.137.0", "linux-x64"), "0.137.0-linux-x64");
  });
});

describe("npmHashesForSystems", (): void => {
  it("maps platform suffixes to integrity hashes through Effect", async (): Promise<void> => {
    const suffixes = {
      "x86_64-linux": "linux-x64",
    } as const;

    const hashes = await Effect.runPromise(
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

  it("fails when platform metadata is missing", async (): Promise<void> => {
    await assertRejects(
      async (): Promise<void> => {
        await Effect.runPromise(
          npmHashesForSystems({ versions: {} }, "0.137.0", { "x86_64-linux": "linux-x64" }),
        );
      },
      Error,
      "Missing npm integrity for 0.137.0-linux-x64",
    );
  });
});

describe("npmHashConfigForSystems", (): void => {
  it("keeps the requested package version in the generated config", async (): Promise<void> => {
    const suffixes = {
      "aarch64-darwin": "darwin-arm64",
      "aarch64-linux": "linux-arm64",
      "x86_64-linux": "linux-x64",
    } as const;

    const config = await Effect.runPromise(
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
      platformPackageHashes: {
        "aarch64-darwin": "sha512-darwin",
        "aarch64-linux": "sha512-linux-arm",
        "x86_64-linux": "sha512-linux-x64",
      },
      version: "0.137.0",
    });
  });
});

describe("release helpers", (): void => {
  it("maps release targets through supported systems", (): void => {
    assertEquals(
      releaseUrlsFromTargets(
        {
          "aarch64-darwin": "darwin_arm64",
          "aarch64-linux": "linux_arm64",
          "x86_64-linux": "linux_amd64",
        },
        (target: string): string => `https://example.test/${target}.tar.gz`,
      ),
      {
        "aarch64-darwin": "https://example.test/darwin_arm64.tar.gz",
        "aarch64-linux": "https://example.test/linux_arm64.tar.gz",
        "x86_64-linux": "https://example.test/linux_amd64.tar.gz",
      },
    );
  });

  it("converts hex sha256 values to SRI hashes", (): void => {
    assertEquals(
      hexSha256ToSRI("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"),
      "sha256-47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=",
    );
  });
});
