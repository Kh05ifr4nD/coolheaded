import { checkedLayout } from "coolheaded/repo/layout/check.ts";

type LayoutRunOutcome =
  | Readonly<{ readonly kind: "passed" }>
  | Readonly<{ readonly kind: "skipped" }>
  | Readonly<{ readonly exitCode: 1; readonly kind: "failed"; readonly stderr: string }>;

async function layoutRun(
  moduleUrl: string,
  mainModule: string,
  checker: () => Promise<void>,
): Promise<LayoutRunOutcome> {
  if (mainModule !== moduleUrl) {
    return { kind: "skipped" };
  }

  try {
    await checker();
    return { kind: "passed" };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return { exitCode: 1, kind: "failed", stderr: `${message}\n` };
  }
}

async function main(moduleUrl: string): Promise<void> {
  const outcome = await layoutRun(moduleUrl, Deno.mainModule, checkedLayout);
  if (outcome.kind === "failed") {
    await Deno.stderr.write(new globalThis.TextEncoder().encode(outcome.stderr));
    Deno.exit(outcome.exitCode);
  }
}

void main(import.meta.url);

export { checkedLayout, checkLayout } from "coolheaded/repo/layout/check.ts";
export { layoutRun };
export type { LayoutRunOutcome };
