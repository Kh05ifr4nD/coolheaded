import { Effect } from "effect";
import { commandOutput } from "./updateScript.ts";

function temporaryDirectory(): Effect.Effect<string, Error> {
  return commandOutput("mktemp", ["-d"]);
}

function removeDirectory(path: string): Effect.Effect<void, Error> {
  return Effect.asVoid(commandOutput("rm", ["-rf", path]));
}

function withTemporaryDirectory<Success, Failure extends Error>(
  useDirectory: (path: string) => Effect.Effect<Success, Failure>,
): Effect.Effect<Success, Error | Failure> {
  return Effect.flatMap(
    temporaryDirectory(),
    (workspacePath: string): Effect.Effect<Success, Error | Failure> =>
      Effect.ensuring(
        useDirectory(workspacePath),
        Effect.catchAll(removeDirectory(workspacePath), () => Effect.void),
      ),
  );
}

export { withTemporaryDirectory };
