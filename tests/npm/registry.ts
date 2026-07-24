import { describe, it } from "@jsr/std__testing/bdd";
import {
  npmPlatformPackageVersion,
  npmRegistryPackageUrl,
  npmScopedTarballUrl,
} from "coolheaded/npm/registry.ts";
import { assertEquals } from "@jsr/std__assert";

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
