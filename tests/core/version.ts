import { assertProperty, defineReplayTarget } from "coolheadedTestSupport/fastCheck.ts";
import { compareVersions, isSemver } from "coolheaded/core/version.ts";
import { describe, it } from "@jsr/std__testing/bdd";
import { assertEquals } from "@jsr/std__assert";
import fc from "fast-check";

const MAX_VERSION_PART = 1_000_000;
const versionPart = fc.integer({ max: MAX_VERSION_PART, min: 0 });
const coreVersion = fc
  .tuple(versionPart, versionPart, versionPart)
  .map(
    ([major, minor, patch]: readonly [number, number, number]): string =>
      `${major}.${minor}.${patch}`,
  );
const buildIdentifier = fc.stringMatching(/^[0-9A-Za-z-]{1,16}$/u);
const numericPrereleaseIdentifier = fc.integer({ max: MAX_VERSION_PART, min: 0 }).map(String);
const nonnumericPrereleaseIdentifier = fc.stringMatching(
  /^(?:[A-Za-z-][0-9A-Za-z-]{0,15}|[0-9][0-9A-Za-z-]{0,14}[A-Za-z-][0-9A-Za-z-]*)$/u,
);
const prereleaseIdentifier = fc.oneof(numericPrereleaseIdentifier, nonnumericPrereleaseIdentifier);
const prerelease = fc
  .array(prereleaseIdentifier, { maxLength: 4, minLength: 1 })
  .map((identifiers: readonly string[]): string => identifiers.join("."));
const buildMetadata = fc
  .array(buildIdentifier, { maxLength: 4, minLength: 1 })
  .map((identifiers: readonly string[]): string => identifiers.join("."));
const precedenceVersion = fc
  .tuple(coreVersion, fc.option(prerelease, { nil: undefined }))
  .map(([core, prereleaseValue]: readonly [string, string | undefined]): string =>
    prereleaseValue === undefined ? core : `${core}-${prereleaseValue}`,
  );
const fullVersion = fc
  .tuple(precedenceVersion, fc.option(buildMetadata, { nil: undefined }))
  .map(([precedence, build]: readonly [string, string | undefined]): string =>
    build === undefined ? precedence : `${precedence}+${build}`,
  );

describe("SemVer", (): void => {
  it("accepts specification examples", (): void => {
    for (const version of [
      "0.0.0",
      "1.0.0-alpha",
      "1.0.0-alpha.1",
      "1.0.0+build.1",
      "1.0.0-alpha+build.1",
    ]) {
      assertEquals(isSemver(version), true);
    }
  });

  it("accepts nonnumeric prerelease identifiers beginning with digits", (): void => {
    for (const version of ["1.0.0-0E-0", "1.0.0-1e1", "1.0.0-0x1", "1.0.0-0b1"]) {
      assertEquals(isSemver(version), true);
    }
  });

  it("rejects malformed versions", (): void => {
    for (const version of [
      "01.0.0",
      "1.01.0",
      "1.0.01",
      "1.0.0-",
      "1.0.0-01",
      "1.0.0-alpha..1",
      "1.0.0-alpha_1",
      "1.0.0+",
      "1.0.0+build+extra",
      "v1.0.0",
    ]) {
      assertEquals(isSemver(version), false);
    }
  });

  it("implements specification precedence vectors", (): void => {
    const ascendingVersions = [
      "1.0.0-alpha",
      "1.0.0-alpha.1",
      "1.0.0-alpha.beta",
      "1.0.0-beta",
      "1.0.0-beta.2",
      "1.0.0-beta.11",
      "1.0.0-rc.1",
      "1.0.0",
    ] as const;

    for (const [index, version] of ascendingVersions.entries()) {
      const nextVersion = ascendingVersions[index + 1];
      if (nextVersion !== undefined) {
        assertEquals(compareVersions(version, nextVersion) < 0, true);
      }
    }
  });

  it("ignores build metadata in precedence", (): void => {
    assertEquals(compareVersions("1.0.0+build.1", "1.0.0+build.2"), 0);
    assertEquals(compareVersions("1.0.0-alpha+build.1", "1.0.0-alpha+build.2"), 0);
    assertEquals(compareVersions("1.0.0-0E-0+build.1", "1.0.0-0E-0+build.2"), 0);
  });

  it("orders numeric prerelease identifiers before nonnumeric identifiers", (): void => {
    assertEquals(compareVersions("1.0.0-1", "1.0.0-alpha") < 0, true);
    assertEquals(compareVersions("1.0.0-0", "1.0.0-0E-0") < 0, true);
    assertEquals(compareVersions("1.0.0-2", "1.0.0-11") < 0, true);
  });

  it("orders nonnumeric prerelease identifiers lexically", (): void => {
    assertEquals(compareVersions("1.0.0-0E-0", "1.0.0-0E-1") < 0, true);
  });
});

const validName = "SemVer accepts all generated valid versions";
Deno.test(validName, (): void => {
  assertProperty(
    defineReplayTarget("tests/core/version.ts", validName),
    fc.property(fullVersion, (version: string): void => {
      assertEquals(isSemver(version), true);
    }),
  );
});

const symmetryName = "SemVer comparison is reflexive and antisymmetric";
Deno.test(symmetryName, (): void => {
  assertProperty(
    defineReplayTarget("tests/core/version.ts", symmetryName),
    fc.property(fullVersion, fullVersion, (left: string, right: string): void => {
      assertEquals(compareVersions(left, left), 0);
      assertEquals(
        Math.sign(compareVersions(left, right)),
        -Math.sign(compareVersions(right, left)),
      );
    }),
  );
});

const transitiveName = "SemVer comparison is transitive";
Deno.test(transitiveName, (): void => {
  assertProperty(
    defineReplayTarget("tests/core/version.ts", transitiveName),
    fc.property(
      fullVersion,
      fullVersion,
      fullVersion,
      (left: string, middle: string, right: string): void => {
        if (compareVersions(left, middle) <= 0 && compareVersions(middle, right) <= 0) {
          assertEquals(compareVersions(left, right) <= 0, true);
        }
        if (compareVersions(left, middle) >= 0 && compareVersions(middle, right) >= 0) {
          assertEquals(compareVersions(left, right) >= 0, true);
        }
      },
    ),
  );
});

const buildName = "SemVer comparison ignores generated build metadata";
Deno.test(buildName, (): void => {
  assertProperty(
    defineReplayTarget("tests/core/version.ts", buildName),
    fc.property(
      precedenceVersion,
      buildMetadata,
      buildMetadata,
      (version: string, leftBuild: string, rightBuild: string): void => {
        assertEquals(compareVersions(`${version}+${leftBuild}`, `${version}+${rightBuild}`), 0);
      },
    ),
  );
});

const formatName = "SemVer parses independently formatted generated versions";
Deno.test(formatName, (): void => {
  assertProperty(
    defineReplayTarget("tests/core/version.ts", formatName),
    fc.property(precedenceVersion, buildMetadata, (version: string, build: string): void => {
      const formatted = `${version}+${build}`;

      assertEquals(isSemver(formatted), true);
      assertEquals(compareVersions(formatted, formatted), 0);
      assertEquals(compareVersions(formatted, version), 0);
    }),
  );
});

const prereleaseName = "SemVer orders generated prereleases before releases";
Deno.test(prereleaseName, (): void => {
  assertProperty(
    defineReplayTarget("tests/core/version.ts", prereleaseName),
    fc.property(
      coreVersion,
      prereleaseIdentifier,
      (version: string, prereleaseValue: string): void => {
        assertEquals(compareVersions(`${version}-${prereleaseValue}`, version) < 0, true);
      },
    ),
  );
});
