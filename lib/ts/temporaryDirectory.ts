import { Effect } from "effect";
import { UpdateError } from "./updateScript.ts";

function temporaryDirectory(): Effect.Effect<string, Error> {
  return Effect.tryPromise({
    catch(error: unknown): Error {
      return error instanceof Error
        ? error
        : new UpdateError("Failed to create temporary directory");
    },
    async try(): Promise<string> {
      return await Deno.makeTempDir({ prefix: "coolheaded-" });
    },
  });
}

function removeDirectory(path: string): Effect.Effect<void, Error> {
  return Effect.tryPromise({
    catch(error: unknown): Error {
      return error instanceof Error ? error : new UpdateError(`Failed to remove ${path}`);
    },
    async try(): Promise<void> {
      await Deno.remove(path, { recursive: true });
    },
  });
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
