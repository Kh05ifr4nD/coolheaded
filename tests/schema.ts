import { assertEquals, assertRejects, assertThrows } from "@jsr/std__assert";
import { describe, it } from "@jsr/std__testing/bdd";
import {
  hexSha256ToSRI,
  releaseHashUpdateProgram,
  releaseUrlsFromTargets,
} from "coolheaded/update/release.ts";
import { npmHashConfigForSystems, npmHashesForSystems } from "coolheaded/npm/platformHash.ts";
import {
  npmPackageHashUpdateProgram,
  npmPlatformPackageHashUpdateProgram,
} from "coolheaded/npm/packageHash.ts";
import {
  npmPlatformPackageVersion,
  npmRegistryPackageUrl,
  npmScopedTarballUrl,
} from "coolheaded/npm/registry.ts";
import { Effect } from "effect";
import fc from "fast-check";
import { parsePackageHashConfig } from "coolheaded/pin/schema.ts";

const COMPLETE_HASHES = {
  "aarch64-darwin": "sha512-a",
  "aarch64-linux": "sha512-b",
  "x86_64-linux": "sha512-c",
} as const;

const OK_STATUS = 200;

interface RequestLike {
  readonly url: string;
}

interface UrlLike {
  readonly href: string;
}

type FetchInput = RequestLike | string | UrlLike;

function fetchInputUrl(input: FetchInput): string {
  if (typeof input === "string") {
    return input;
  }

  if ("href" in input) {
    return input.href;
  }

  return input.url;
}

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

describe("npm package hash update programs", (): void => {
  it("writes same-hash npm package pins through the shared update program", async (): Promise<void> => {
    const originalFetch = globalThis.fetch;
    const pinFilePath = await Deno.makeTempFile();

    globalThis.fetch = ((input: FetchInput) => {
      assertEquals(fetchInputUrl(input), "https://registry.npmjs.org/example");

      return Promise.resolve(
        globalThis.Response.json(
          {
            versions: {
              "1.0.0": {
                dist: {
                  integrity: "sha512-package",
                },
              },
            },
          },
          { status: OK_STATUS },
        ),
      );
    }) as typeof globalThis.fetch;

    try {
      await Effect.runPromise(
        npmPackageHashUpdateProgram({
          args: ["1.0.0"],
          packageName: "example",
          pinFilePath,
        }),
      );

      assertEquals(JSON.parse(await Deno.readTextFile(pinFilePath)), {
        platformPackageHashes: {
          "aarch64-darwin": "sha512-package",
          "aarch64-linux": "sha512-package",
          "x86_64-linux": "sha512-package",
        },
        version: "1.0.0",
      });
    } finally {
      globalThis.fetch = originalFetch;
      await Deno.remove(pinFilePath);
    }
  });

  it("writes platform npm package pins through the shared update program", async (): Promise<void> => {
    const originalFetch = globalThis.fetch;
    const pinFilePath = await Deno.makeTempFile();

    globalThis.fetch = ((input: FetchInput) => {
      assertEquals(fetchInputUrl(input), "https://registry.npmjs.org/example");

      return Promise.resolve(
        globalThis.Response.json(
          {
            versions: {
              "1.0.0-darwin-arm64": {
                dist: {
                  integrity: "sha512-darwin",
                },
              },
              "1.0.0-linux-arm64": {
                dist: {
                  integrity: "sha512-linux-arm",
                },
              },
              "1.0.0-linux-x64": {
                dist: {
                  integrity: "sha512-linux-x64",
                },
              },
            },
          },
          { status: OK_STATUS },
        ),
      );
    }) as typeof globalThis.fetch;

    try {
      await Effect.runPromise(
        npmPlatformPackageHashUpdateProgram({
          args: ["1.0.0"],
          packageName: "example",
          pinFilePath,
          suffixes: {
            "aarch64-darwin": "darwin-arm64",
            "aarch64-linux": "linux-arm64",
            "x86_64-linux": "linux-x64",
          },
        }),
      );

      assertEquals(JSON.parse(await Deno.readTextFile(pinFilePath)), {
        platformPackageHashes: {
          "aarch64-darwin": "sha512-darwin",
          "aarch64-linux": "sha512-linux-arm",
          "x86_64-linux": "sha512-linux-x64",
        },
        version: "1.0.0",
      });
    } finally {
      globalThis.fetch = originalFetch;
      await Deno.remove(pinFilePath);
    }
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

  it("writes release hash pins through the shared update program", async (): Promise<void> => {
    const pinFilePath = await Deno.makeTempFile();
    const emptySha256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

    try {
      await Effect.runPromise(
        releaseHashUpdateProgram({
          args: ["0.1.0"],
          latestVersion: (): Effect.Effect<string, Error> => Effect.succeed("0.2.0"),
          pinFilePath,
          source: "sha256Sum",
          urlsForVersion: () =>
            releaseUrlsFromTargets(
              {
                "aarch64-darwin": `data:text/plain,${emptySha256}`,
                "aarch64-linux": `data:text/plain,${emptySha256}`,
                "x86_64-linux": `data:text/plain,${emptySha256}`,
              },
              (target: string): string => target,
            ),
        }),
      );

      assertEquals(JSON.parse(await Deno.readTextFile(pinFilePath)), {
        platformPackageHashes: {
          "aarch64-darwin": "sha256-47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=",
          "aarch64-linux": "sha256-47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=",
          "x86_64-linux": "sha256-47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=",
        },
        version: "0.1.0",
      });
    } finally {
      await Deno.remove(pinFilePath);
    }
  });
});
