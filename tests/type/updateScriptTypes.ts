import {
  UpdateError,
  requestedOrLatestVersion,
  requestedOrNewerPinVersion,
  updateNewerPinVersion,
} from "coolheaded/core/updateScript.ts";
import { Effect } from "effect";
import type { IsExact } from "./testingTypes.ts";
import { assertType } from "@jsr/std__testing/types";

interface LatestVersionError extends Error {
  readonly _tag: "LatestVersionError";
}

interface UpdateVersionError extends Error {
  readonly _tag: "UpdateVersionError";
}

function latestVersionError(): LatestVersionError {
  const tag: Readonly<{ _tag: "LatestVersionError" }> = { _tag: "LatestVersionError" };
  return Object.assign(new Error("latest"), tag);
}

function updateVersionError(): UpdateVersionError {
  const tag: Readonly<{ _tag: "UpdateVersionError" }> = { _tag: "UpdateVersionError" };
  return Object.assign(new Error("update"), tag);
}

function latest(): Effect.Effect<string, LatestVersionError> {
  return Effect.fail(latestVersionError());
}

function update(): Effect.Effect<void, UpdateVersionError> {
  return Effect.fail(updateVersionError());
}

const updateError = new UpdateError("pin");
const requestedOrLatest = requestedOrLatestVersion([], latest);
const requestedOrNewer = requestedOrNewerPinVersion([], latest, "pin.json");
const updated = updateNewerPinVersion([], latest, "pin.json", update);
type UpdateErrorType = typeof updateError;
type LatestChannel =
  typeof requestedOrLatest extends Effect.Effect<unknown, infer ErrorChannel>
    ? ErrorChannel
    : never;
type NewerChannel =
  typeof requestedOrNewer extends Effect.Effect<unknown, infer ErrorChannel> ? ErrorChannel : never;
type UpdatedChannel =
  typeof updated extends Effect.Effect<unknown, infer ErrorChannel> ? ErrorChannel : never;

assertType<IsExact<typeof requestedOrLatest, Effect.Effect<string, LatestVersionError>>>(true);
assertType<
  IsExact<
    typeof requestedOrNewer,
    Effect.Effect<string | undefined, LatestVersionError | UpdateErrorType>
  >
>(true);
assertType<
  IsExact<
    typeof updated,
    Effect.Effect<void, LatestVersionError | UpdateErrorType | UpdateVersionError>
  >
>(true);
assertType<Error extends LatestChannel ? true : false>(false);
assertType<Error extends NewerChannel ? true : false>(false);
assertType<Error extends UpdatedChannel ? true : false>(false);
