import { describe, it } from "@jsr/std__testing/bdd";
import {
  latestGitHubVersion,
  latestNpmVersion,
  latestPyPiVersion,
} from "coolheaded/latestVersion.ts";
import { assertEquals } from "@jsr/std__assert";

describe("latest version exports", (): void => {
  it("exposes latest query functions", (): void => {
    assertEquals(typeof latestGitHubVersion, "function");
    assertEquals(typeof latestNpmVersion, "function");
    assertEquals(typeof latestPyPiVersion, "function");
  });
});
