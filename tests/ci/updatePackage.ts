import { UpdateError, requestedOrNewerPinVersion } from "coolheaded/core/updateScript.ts";
import { assertInstanceOf, assertThrows } from "@jsr/std__assert";
import { describe, it } from "@jsr/std__testing/bdd";
import { Effect } from "effect";
import { assertVersionAdvanced } from "coolheadedCi/update/run/package.ts";

describe("package update version gate", (): void => {
  it("accepts a release after its prerelease", (): void => {
    assertVersionAdvanced("example", "1.0.0-rc.1", "1.0.0");
  });

  it("rejects build metadata as a version advance", (): void => {
    assertThrows(
      (): void => {
        assertVersionAdvanced("example", "1.0.0+build.1", "1.0.0+build.2");
      },
      UpdateError,
      "without a version advance",
    );
  });

  it("rejects a prerelease after its release", (): void => {
    assertThrows(
      (): void => {
        assertVersionAdvanced("example", "1.0.0", "1.0.0-rc.1");
      },
      UpdateError,
      "without a version advance",
    );
  });

  it("rejects malformed current and new versions with typed errors", (): void => {
    assertThrows(
      (): void => {
        assertVersionAdvanced("example", "01.0.0", "1.0.1");
      },
      UpdateError,
      "invalid current SemVer",
    );
    assertThrows(
      (): void => {
        assertVersionAdvanced("example", "1.0.0", "1.0.1-");
      },
      UpdateError,
      "produced invalid SemVer",
    );
  });
});

describe("requested pin version validation", (): void => {
  it("rejects a malformed explicit override", async (): Promise<void> => {
    const error = await Effect.runPromise(
      Effect.flip(
        requestedOrNewerPinVersion(
          ["1.0.0-"],
          (): Effect.Effect<string> => Effect.succeed("1.0.0"),
          "./unused.json",
        ),
      ),
    );
    assertInstanceOf(error, UpdateError);
  });

  it("rejects a malformed current pin version", async (): Promise<void> => {
    const pinPath = await Deno.makeTempFile();
    try {
      await Deno.writeTextFile(pinPath, JSON.stringify({ version: "1.0.0-" }));
      const error = await Effect.runPromise(
        Effect.flip(
          requestedOrNewerPinVersion(
            [],
            (): Effect.Effect<string> => Effect.succeed("1.0.0"),
            pinPath,
          ),
        ),
      );
      assertInstanceOf(error, UpdateError);
    } finally {
      await Deno.remove(pinPath);
    }
  });

  it("rejects a malformed fetched candidate", async (): Promise<void> => {
    const pinPath = await Deno.makeTempFile();
    try {
      await Deno.writeTextFile(pinPath, JSON.stringify({ version: "1.0.0" }));
      const error = await Effect.runPromise(
        Effect.flip(
          requestedOrNewerPinVersion(
            [],
            (): Effect.Effect<string> => Effect.succeed("1.0.0-"),
            pinPath,
          ),
        ),
      );
      assertInstanceOf(error, UpdateError);
    } finally {
      await Deno.remove(pinPath);
    }
  });
});
