import { checkedFileSpec } from "coolheaded/repo/fileSpec/check.ts";

async function writeError(error: unknown): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  const encodedMessage = new globalThis.TextEncoder().encode(`${message}\n`);
  await Deno.stderr.write(encodedMessage);
}

async function main(moduleUrl: string): Promise<void> {
  if (Deno.mainModule !== moduleUrl) {
    return;
  }

  try {
    await checkedFileSpec();
  } catch (error: unknown) {
    await writeError(error);
    Deno.exit(1);
  }
}

void main(import.meta.url);

export { checkedFileSpec, checkFileSpec } from "coolheaded/repo/fileSpec/check.ts";
