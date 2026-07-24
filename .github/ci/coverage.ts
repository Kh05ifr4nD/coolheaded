import { fromFileUrl, isAbsolute, relative } from "@jsr/std__path";
import type { CommandRunner } from "coolheaded/core/commandRunner.ts";
import { denoCommandRunner } from "coolheaded/core/denoCommandRunner.ts";
import { evaluateCoverage } from "./coveragePolicy.ts";

type InputErrorKind = "duplicateSource" | "invalidSource" | "inventoryFailure" | "malformedLcov";
type ErrorDetails = Readonly<Record<string, unknown>>;
type Occurrences<Value> = readonly [values: readonly Value[], add: (value: Value) => void];
type RuntimeSources = Promise<readonly string[]>;
type SourceCoverage = Parameters<typeof evaluateCoverage>[1][number];
type WriteMap<Key, Value> = Readonly<Map<Key, Value>>;

class CoverageInputError extends Error {
  public readonly details: ErrorDetails;
  public readonly kind: InputErrorKind;
  public override readonly name = "CoverageInputError";
  public constructor(kind: InputErrorKind, details: ErrorDetails, cause?: unknown) {
    super(`${kind}: ${JSON.stringify(details)}`, cause === undefined ? undefined : { cause });
    this.details = details;
    this.kind = kind;
  }
}

interface MutableRecord {
  readonly branches: Readonly<Map<string, number>>;
  readonly functionHits: Occurrences<readonly [count: number, name: string]>;
  readonly functions: Occurrences<readonly [line: number, name: string]>;
  readonly lines: Readonly<Map<number, number>>;
  readonly path: string;
  readonly summaries: Readonly<Map<string, number>>;
}

function occurrences<Value>(): Occurrences<Value> {
  const values: Value[] = [];
  function add(value: Value): void {
    values.push(value);
  }
  return [values, add];
}

function malformed(details: ErrorDetails): never {
  throw new CoverageInputError("malformedLcov", details);
}

function rejectMalformed(condition: boolean, details: ErrorDetails): void {
  if (condition) {
    malformed(details);
  }
}

function hasSummary(record: Readonly<MutableRecord>, fields: readonly string[]): boolean {
  return fields.some((field) => record.summaries.has(field));
}

function naturalNumber(value: string, field: string, positive = false): number {
  const parsed = Number(value);
  const valid =
    /^(?:0|[1-9]\d*)$/u.test(value) && Number.isSafeInteger(parsed) && (!positive || parsed > 0);
  rejectMalformed(!valid, { field, value });
  return parsed;
}

function normalizedSource(source: string, repositoryRoot: string): string {
  try {
    let absolutePath = source;
    if (!isAbsolute(source)) {
      const url = new globalThis.URL(source);
      if (url.protocol !== "file:" || [url.hostname, url.hash, url.search].some(Boolean)) {
        throw new CoverageInputError("invalidSource", { source });
      }
      absolutePath = fromFileUrl(url);
    }
    const path = relative(repositoryRoot, absolutePath);
    if (path.length === 0 || isAbsolute(path) || path === ".." || path.startsWith("../")) {
      throw new CoverageInputError("invalidSource", { source });
    }
    return path;
  } catch (error) {
    if (error instanceof CoverageInputError) {
      throw error;
    }
    throw new CoverageInputError("invalidSource", { repositoryRoot, source }, error);
  }
}

function put<Key, Value>(map: WriteMap<Key, Value>, key: Key, value: Value, tag: string): void {
  rejectMalformed(map.has(key), { field: tag, key });
  map.set(key, value);
}

function parseRecordField(record: Readonly<MutableRecord>, field: string, value: string): void {
  if (field === "DA") {
    rejectMalformed(hasSummary(record, ["LF", "LH"]), { field, value });
    const parts = value.split(",");
    rejectMalformed(
      (parts.length !== 2 && parts.length !== 3) ||
        (parts.length === 3 && !/^[0-9a-f]{32}$/u.test(parts[2] ?? "")),
      { field, value },
    );
    const line = naturalNumber(parts[0] ?? "", field, true);
    const count = naturalNumber(parts[1] ?? "", field);
    put(record.lines, line, count, field);
    return;
  }
  if (field === "BRDA") {
    rejectMalformed(hasSummary(record, ["BRF", "BRH"]), { field, value });
    const parts = value.split(",");
    rejectMalformed(parts.length !== 4, { field, value });
    const line = naturalNumber(parts[0] ?? "", field, true);
    const block = naturalNumber(parts[1] ?? "", field);
    const branch = naturalNumber(parts[2] ?? "", field);
    const taken = parts[3] === "-" ? 0 : naturalNumber(parts[3] ?? "", field);
    put(record.branches, `${line},${block},${branch}`, taken, field);
    return;
  }
  if (field === "FN" || field === "FNDA") {
    const separator = value.indexOf(",");
    rejectMalformed(separator <= 0 || separator === value.length - 1, { field, value });
    const [number, name] = [value.slice(0, separator), value.slice(separator + 1)];
    if (field === "FN") {
      rejectMalformed(record.functionHits[0].length > 0 || hasSummary(record, ["FNF", "FNH"]), {
        field,
        value,
      });
      const line = naturalNumber(number, field, true);
      rejectMalformed(
        record.functions[0].some(
          ([functionLine, functionName]) => functionLine === line && functionName === name,
        ),
        { field, value },
      );
      record.functions[1]([line, name]);
    } else {
      rejectMalformed(hasSummary(record, ["FNF", "FNH"]), { field, value });
      const index = record.functionHits[0].length;
      rejectMalformed(name !== record.functions[0][index]?.[1], { field, index, name });
      record.functionHits[1]([naturalNumber(number, field), name]);
    }
    return;
  }
  if (["BRF", "BRH", "FNF", "FNH", "LF", "LH"].includes(field)) {
    put(record.summaries, field, naturalNumber(value, field), field);
    return;
  }
  malformed({ field, value });
}

function recordCounters(record: Readonly<MutableRecord>): SourceCoverage {
  const lineTotal = record.lines.size;
  const lineCovered = [...record.lines.values()].filter((count) => count > 0).length;
  const branchTotal = record.branches.size;
  const branchCovered = [...record.branches.values()].filter((count) => count > 0).length;
  const functionCovered = record.functionHits[0].filter(([count]) => count > 0).length;
  if (
    record.functions[0].length !== record.functionHits[0].length ||
    record.summaries.get("BRF") !== branchTotal ||
    record.summaries.get("BRH") !== branchCovered ||
    record.summaries.get("FNF") !== record.functions[0].length ||
    record.summaries.get("FNH") !== functionCovered ||
    record.summaries.get("LF") !== lineTotal ||
    record.summaries.get("LH") !== lineCovered
  ) {
    malformed({ path: record.path });
  }
  return {
    branches: { covered: branchCovered, total: branchTotal },
    lines: { covered: lineCovered, total: lineTotal },
    path: record.path,
  };
}

function parseLcov(input: string, repositoryRoot: string): readonly SourceCoverage[] {
  const records: SourceCoverage[] = [];
  let current: MutableRecord | undefined = undefined;
  for (const line of input.split(/\r?\n/u).filter((value) => value.length > 0 && value !== "TN:")) {
    const separator = line.indexOf(":");
    const field = separator === -1 ? line : line.slice(0, separator);
    const value = separator === -1 ? "" : line.slice(separator + 1);
    if (field === "SF") {
      rejectMalformed(current !== undefined, { field });
      const path = normalizedSource(value, repositoryRoot);
      if (records.some((record) => record.path === path)) {
        throw new CoverageInputError("duplicateSource", { path });
      }
      current = {
        branches: new Map(),
        functionHits: occurrences(),
        functions: occurrences(),
        lines: new Map(),
        path,
        summaries: new Map(),
      };
    } else if (field === "end_of_record") {
      if (current === undefined || value.length > 0) {
        malformed({ field });
      }
      records.push(recordCounters(current));
      current = undefined;
    } else if (current === undefined) {
      malformed({ field, value });
    } else {
      parseRecordField(current, field, value);
    }
  }
  if (current !== undefined) {
    malformed({ path: current.path });
  }
  return records;
}

async function trackedRuntimeSources(runner: CommandRunner, git: string): RuntimeSources {
  const request = {
    command: [git, "ls-files", "-z", "--", ".github/ci", "lib/ts", "packages"],
  } as const;
  const result = await runner.run(request).catch((error: unknown): never => {
    throw new CoverageInputError("inventoryFailure", { cause: error, request }, error);
  });
  if (result.code !== 0) {
    throw new CoverageInputError("inventoryFailure", { request, result });
  }
  return result.stdout
    .split("\0")
    .filter((path) => /^(?:\.github\/ci\/.*|lib\/ts\/.*|packages\/[^/]+\/update)\.ts$/u.test(path))
    .toSorted();
}

async function main(): Promise<void> {
  const gitExecutable = Deno.env.get("COOLHEADED_GIT");
  if (gitExecutable === undefined || !isAbsolute(gitExecutable)) {
    throw new CoverageInputError("inventoryFailure", { gitExecutable });
  }
  const body = await new globalThis.Response(Deno.stdin.readable).bytes();
  const input = new globalThis.TextDecoder().decode(body);
  const inventory = await trackedRuntimeSources(denoCommandRunner, gitExecutable);
  const records = parseLcov(input, Deno.cwd());
  const foreign = records.flatMap(({ path }) => (inventory.includes(path) ? [] : [path]));
  if (foreign.length > 0) {
    throw new CoverageInputError("invalidSource", { paths: foreign.toSorted() });
  }
  const output = `${JSON.stringify(evaluateCoverage(inventory, records))}\n`;
  await Deno.stdout.write(new globalThis.TextEncoder().encode(output));
}

if (import.meta.main) {
  void main();
}

export { CoverageInputError, parseLcov, trackedRuntimeSources };
