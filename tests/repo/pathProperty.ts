import { assertEquals, assertThrows } from "@jsr/std__assert";
import { assertProperty, defineReplayTarget } from "coolheadedTestSupport/fastCheck.ts";
import { gitPaths, validateGitPathNames } from "coolheaded/repo/fileSpec/git.ts";
import fc from "fast-check";

const MAX_PATHS = 30;
const pathSegment = fc.stringMatching(/^[a-z0-9][a-z0-9._-]{0,11}$/u);
const pathAtom = fc
  .array(pathSegment, { maxLength: 3, minLength: 1 })
  .map((segments: readonly string[]): string => segments.join("/"));

const decodeName = "Git path codec decodes NUL records and sorts valid pathnames";
Deno.test(decodeName, (): void => {
  assertProperty(
    defineReplayTarget("tests/repo/pathProperty.ts", decodeName),
    fc.property(
      fc.uniqueArray(pathAtom, { maxLength: MAX_PATHS }),
      (paths: readonly string[]): void => {
        const output = paths.length === 0 ? "" : `${paths.join("\0")}\0`;
        assertEquals(gitPaths(output), [...paths].toSorted());
      },
    ),
  );
});

const nfcName = "Git path validation rejects generated non-NFC pathnames";
Deno.test(nfcName, (): void => {
  assertProperty(
    defineReplayTarget("tests/repo/pathProperty.ts", nfcName),
    fc.property(
      fc.constantFrom("e\u0301", "A\u030A", "n\u0303"),
      pathAtom,
      (decomposed: string, suffix: string): void => {
        assertThrows((): void => {
          validateGitPathNames([`${decomposed}-${suffix}`]);
        });
      },
    ),
  );
});

const collisionName = "Git path validation rejects generated case-fold collisions";
Deno.test(collisionName, (): void => {
  assertProperty(
    defineReplayTarget("tests/repo/pathProperty.ts", collisionName),
    fc.property(fc.stringMatching(/^[a-z]{1,24}$/u), (path: string): void => {
      assertThrows((): void => {
        validateGitPathNames([path, path.toUpperCase()]);
      });
    }),
  );
});
