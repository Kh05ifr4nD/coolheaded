import { checkedFileSpec } from "coolheaded/repo/fileSpec/check.ts";

type FileSpecRunOutcome =
  | Readonly<{ readonly kind: "passed" }>
  | Readonly<{ readonly kind: "skipped" }>
  | Readonly<{ readonly exitCode: 1; readonly kind: "failed"; readonly stderr: string }>;

async function fileSpecRun(
  moduleUrl: string,
  mainModule: string,
  checker: () => Promise<void>,
): Promise<FileSpecRunOutcome> {
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
  const outcome = await fileSpecRun(moduleUrl, Deno.mainModule, checkedFileSpec);
  if (outcome.kind === "failed") {
    await Deno.stderr.write(new globalThis.TextEncoder().encode(outcome.stderr));
    Deno.exit(outcome.exitCode);
  }
}

void main(import.meta.url);

export { checkedFileSpec, checkFileSpec } from "coolheaded/repo/fileSpec/check.ts";
export { fileSpecRun };
export type { FileSpecRunOutcome };
