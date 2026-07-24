import { assertProperty, defineReplayTarget } from "coolheadedTestSupport/fastCheck.ts";
import { assertEquals } from "@jsr/std__assert";
import fc from "fast-check";
import { newerPinVersion } from "coolheaded/core/updateScript.ts";

const MAX_VERSION_PART = 1_000_000;
const versionPart = fc.integer({ max: MAX_VERSION_PART, min: 0 });

const selectionName = "update candidate selection accepts only generated newer versions";
Deno.test(selectionName, (): void => {
  assertProperty(
    defineReplayTarget("tests/update/stateProperty.ts", selectionName),
    fc.property(
      fc.tuple(versionPart, versionPart, versionPart),
      fc.constantFrom(-1, 0, 1),
      ([major, minor, patch]: readonly [number, number, number], relation: number): void => {
        const current = `${major}.${minor}.${patch}`;
        let candidatePatch = patch;
        if (relation < 0) {
          candidatePatch = Math.max(0, patch - 1);
        } else if (relation > 0) {
          candidatePatch = patch + 1;
        }
        const candidate = `${major}.${minor}.${candidatePatch}`;
        const candidateIsNewer = candidatePatch > patch;

        if (candidateIsNewer) {
          assertEquals(newerPinVersion(current, candidate), candidate);
        } else {
          assertEquals(typeof newerPinVersion(current, candidate), "undefined");
        }
        assertEquals(newerPinVersion(`${current}-alpha`, current), current);
        assertEquals(typeof newerPinVersion(current, `${current}-alpha`), "undefined");
        assertEquals(typeof newerPinVersion(`${current}+left`, `${current}+right`), "undefined");
      },
    ),
  );
});
