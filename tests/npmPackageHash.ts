import { assertEquals, assertRejects } from "@jsr/std__assert";
import { describe, it } from "@jsr/std__testing/bdd";
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
