import { assertEquals, assertInstanceOf, assertRejects } from "@jsr/std__assert";
import { describe, it } from "@jsr/std__testing/bdd";
import { npmHashConfigForSystems, npmHashesForSystems } from "coolheaded/npm/platformHash.ts";
import {
  npmPackageHashConfig,
  npmPackageHashUpdateProgram,
  npmPlatformPackageHashConfig,
  npmPlatformPackageHashUpdateProgram,
} from "coolheaded/npm/packageHash.ts";
import {
  npmPlatformPackageVersion,
  npmRegistryPackageUrl,
  npmScopedTarballUrl,
} from "coolheaded/npm/registry.ts";
import { Effect } from "effect";
import { InvalidPackageHashConfigError } from "coolheaded/pin/packageHashConfig.ts";
import { parseSriHash } from "coolheaded/pin/sriHash.ts";
import { withMockedJsonFetch } from "coolheadedTestSupport/fetchMock.ts";

const SHA512_LENGTH = 64;

function repeatedSha512(byte: number): ReturnType<typeof parseSriHash> {
  const digest = new Uint8Array(SHA512_LENGTH).fill(byte);
  const binary = String.fromCodePoint(...digest);
  const encoded = globalThis.btoa(binary);
  return parseSriHash(`sha512-${encoded}`);
}

const SHA512_DARWIN = repeatedSha512(1);
const SHA512_LINUX_ARM = repeatedSha512(2);
const SHA512_LINUX_X64 = repeatedSha512(3);
const SHA512_PACKAGE = repeatedSha512(4);

async function assertMalformedSamePackageLeavesPinUnchanged(): Promise<void> {
  const pinFilePath = await Deno.makeTempFile();
  await Deno.writeTextFile(pinFilePath, "sentinel");

  try {
    await withMockedJsonFetch(
      {
        body: {
          versions: {
            "1.0.0": { dist: { integrity: "sha512-invalid" } },
          },
        },
        expectedUrl: "https://registry.npmjs.org/example",
      },
      async (): Promise<void> => {
        const error = await Effect.runPromise(
          Effect.flip(
            npmPackageHashUpdateProgram({
              args: ["1.0.0"],
              packageName: "example",
              pinFilePath,
            }),
          ),
        );
        assertInstanceOf(error, InvalidPackageHashConfigError);
      },
    );
    assertEquals(await Deno.readTextFile(pinFilePath), "sentinel");
  } finally {
    await Deno.remove(pinFilePath);
  }
}

async function assertMalformedPlatformPackageLeavesPinUnchanged(): Promise<void> {
  const pinFilePath = await Deno.makeTempFile();
  await Deno.writeTextFile(pinFilePath, "sentinel");

  try {
    await withMockedJsonFetch(
      {
        body: {
          versions: {
            "1.0.0-darwin-arm64": { dist: { integrity: "sha512-invalid" } },
            "1.0.0-linux-arm64": { dist: { integrity: SHA512_LINUX_ARM } },
            "1.0.0-linux-x64": { dist: { integrity: SHA512_LINUX_X64 } },
          },
        },
        expectedUrl: "https://registry.npmjs.org/example",
      },
      async (): Promise<void> => {
        const error = await Effect.runPromise(
          Effect.flip(
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
          ),
        );
        assertInstanceOf(error, InvalidPackageHashConfigError);
      },
    );
    assertEquals(await Deno.readTextFile(pinFilePath), "sentinel");
  } finally {
    await Deno.remove(pinFilePath);
  }
}

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
                integrity: SHA512_LINUX_X64,
              },
            },
          },
        },
        "0.137.0",
        suffixes,
      ),
    );

    assertEquals(hashes, {
      "x86_64-linux": SHA512_LINUX_X64,
    });
  });

  it("fails when platform metadata is missing", async (): Promise<void> => {
    await assertRejects(
      async (): Promise<void> => {
        await Effect.runPromise(
          npmHashesForSystems({ versions: {} }, "0.137.0", {
            "x86_64-linux": "linux-x64",
          }),
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
                integrity: SHA512_DARWIN,
              },
            },
            "0.137.0-linux-arm64": {
              dist: {
                integrity: SHA512_LINUX_ARM,
              },
            },
            "0.137.0-linux-x64": {
              dist: {
                integrity: SHA512_LINUX_X64,
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
        "aarch64-darwin": SHA512_DARWIN,
        "aarch64-linux": SHA512_LINUX_ARM,
        "x86_64-linux": SHA512_LINUX_X64,
      },
      version: "0.137.0",
    });
  });

  it("fails malformed platform integrity as a typed config error", async (): Promise<void> => {
    const error = await Effect.runPromise(
      Effect.flip(
        npmHashConfigForSystems(
          {
            versions: {
              "0.137.0-darwin-arm64": { dist: { integrity: "sha512-invalid" } },
              "0.137.0-linux-arm64": { dist: { integrity: SHA512_LINUX_ARM } },
              "0.137.0-linux-x64": { dist: { integrity: SHA512_LINUX_X64 } },
            },
          },
          "0.137.0",
          {
            "aarch64-darwin": "darwin-arm64",
            "aarch64-linux": "linux-arm64",
            "x86_64-linux": "linux-x64",
          },
        ),
      ),
    );

    assertInstanceOf(error, InvalidPackageHashConfigError);
  });
});

describe("npm package hash update programs", (): void => {
  it("fails malformed same-package integrity as a typed config error", async (): Promise<void> => {
    await withMockedJsonFetch(
      {
        body: {
          versions: {
            "1.0.0": { dist: { integrity: "sha512-invalid" } },
          },
        },
        expectedUrl: "https://registry.npmjs.org/example",
      },
      async (): Promise<void> => {
        const error = await Effect.runPromise(
          Effect.flip(npmPackageHashConfig("example", "1.0.0")),
        );
        assertInstanceOf(error, InvalidPackageHashConfigError);
      },
    );
  });

  it("fails malformed platform integrity through the package boundary", async (): Promise<void> => {
    await withMockedJsonFetch(
      {
        body: {
          versions: {
            "1.0.0-darwin-arm64": { dist: { integrity: "sha512-invalid" } },
            "1.0.0-linux-arm64": { dist: { integrity: SHA512_LINUX_ARM } },
            "1.0.0-linux-x64": { dist: { integrity: SHA512_LINUX_X64 } },
          },
        },
        expectedUrl: "https://registry.npmjs.org/example",
      },
      async (): Promise<void> => {
        const error = await Effect.runPromise(
          Effect.flip(
            npmPlatformPackageHashConfig("example", "1.0.0", {
              "aarch64-darwin": "darwin-arm64",
              "aarch64-linux": "linux-arm64",
              "x86_64-linux": "linux-x64",
            }),
          ),
        );
        assertInstanceOf(error, InvalidPackageHashConfigError);
      },
    );
  });

  it("leaves same-package pin output unchanged after malformed integrity", async (): Promise<void> => {
    await assertMalformedSamePackageLeavesPinUnchanged();
  });

  it("leaves platform pin output unchanged after malformed integrity", async (): Promise<void> => {
    await assertMalformedPlatformPackageLeavesPinUnchanged();
  });

  it("writes same-hash npm package pins through the shared update program", async (): Promise<void> => {
    const pinFilePath = await Deno.makeTempFile();

    try {
      await withMockedJsonFetch(
        {
          body: {
            versions: {
              "1.0.0": {
                dist: {
                  integrity: SHA512_PACKAGE,
                },
              },
            },
          },
          expectedUrl: "https://registry.npmjs.org/example",
        },
        async (): Promise<void> => {
          await Effect.runPromise(
            npmPackageHashUpdateProgram({
              args: ["1.0.0"],
              packageName: "example",
              pinFilePath,
            }),
          );
        },
      );

      assertEquals(JSON.parse(await Deno.readTextFile(pinFilePath)), {
        platformPackageHashes: {
          "aarch64-darwin": SHA512_PACKAGE,
          "aarch64-linux": SHA512_PACKAGE,
          "x86_64-linux": SHA512_PACKAGE,
        },
        version: "1.0.0",
      });
    } finally {
      await Deno.remove(pinFilePath);
    }
  });

  it("writes platform npm package pins through the shared update program", async (): Promise<void> => {
    const pinFilePath = await Deno.makeTempFile();

    try {
      await withMockedJsonFetch(
        {
          body: {
            versions: {
              "1.0.0-darwin-arm64": {
                dist: {
                  integrity: SHA512_DARWIN,
                },
              },
              "1.0.0-linux-arm64": {
                dist: {
                  integrity: SHA512_LINUX_ARM,
                },
              },
              "1.0.0-linux-x64": {
                dist: {
                  integrity: SHA512_LINUX_X64,
                },
              },
            },
          },
          expectedUrl: "https://registry.npmjs.org/example",
        },
        async (): Promise<void> => {
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
        },
      );

      assertEquals(JSON.parse(await Deno.readTextFile(pinFilePath)), {
        platformPackageHashes: {
          "aarch64-darwin": SHA512_DARWIN,
          "aarch64-linux": SHA512_LINUX_ARM,
          "x86_64-linux": SHA512_LINUX_X64,
        },
        version: "1.0.0",
      });
    } finally {
      await Deno.remove(pinFilePath);
    }
  });
});
