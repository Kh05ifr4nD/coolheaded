import { Effect } from "effect";
import { runUpdateScript } from "coolheaded/core/updateScript.ts";

runUpdateScript(import.meta.url, () => Effect.void);
