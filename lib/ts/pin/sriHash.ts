type SriAlgorithm = "sha256" | "sha512";
declare const sriHashBrand: unique symbol;
type SriDigest = string & { readonly [sriHashBrand]: true };
type SriHash = `${SriAlgorithm}-${SriDigest}`;

const MAX_BYTE = 255;
const digestLengths: Readonly<Record<SriAlgorithm, number>> = {
  sha256: 32,
  sha512: 64,
};

class InvalidSriHashError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "InvalidSriHashError";
  }
}

function digestLength(algorithm: unknown): number {
  switch (algorithm) {
    case "sha256": {
      return digestLengths.sha256;
    }
    case "sha512": {
      return digestLengths.sha512;
    }
    default: {
      throw new InvalidSriHashError("Unsupported SRI algorithm");
    }
  }
}

function decodeBase64(encodedDigest: string): string {
  try {
    return globalThis.atob(encodedDigest);
  } catch {
    throw new InvalidSriHashError("SRI hash digest must use valid base64");
  }
}

function assertSriHash(value: unknown): asserts value is SriHash {
  if (typeof value !== "string") {
    throw new InvalidSriHashError("SRI hash must be a string");
  }

  const match = /^(?<algorithm>sha256|sha512)-(?<encodedDigest>[A-Za-z0-9+/]+={0,2})$/u.exec(value);
  if (match === null) {
    throw new InvalidSriHashError("SRI hash must contain one supported algorithm and digest");
  }

  const algorithm = match.groups?.["algorithm"];
  const encodedDigest = match.groups?.["encodedDigest"];
  if ((algorithm !== "sha256" && algorithm !== "sha512") || typeof encodedDigest !== "string") {
    throw new InvalidSriHashError("SRI hash must contain one supported algorithm and digest");
  }

  const decodedDigest = decodeBase64(encodedDigest);

  if (globalThis.btoa(decodedDigest) !== encodedDigest) {
    throw new InvalidSriHashError("SRI hash digest must use canonical base64");
  }
  if (decodedDigest.length !== digestLength(algorithm)) {
    throw new InvalidSriHashError(`SRI ${algorithm} digest has the wrong length`);
  }
}

function parseSriHash(value: unknown): SriHash {
  assertSriHash(value);
  return value;
}

function formatSriHash(algorithm: unknown, digest: readonly unknown[]): SriHash {
  const expectedLength = digestLength(algorithm);
  if (digest.length !== expectedLength) {
    throw new InvalidSriHashError(`SRI ${String(algorithm)} digest has the wrong length`);
  }

  const bytes: number[] = [];
  for (const value of digest) {
    if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > MAX_BYTE) {
      throw new InvalidSriHashError("SRI digest must contain byte values");
    }
    bytes.push(value);
  }

  return parseSriHash(`${String(algorithm)}-${globalThis.btoa(String.fromCodePoint(...bytes))}`);
}

function sriHashAlgorithm(hash: SriHash): SriAlgorithm {
  const algorithm = hash.slice(0, hash.indexOf("-"));
  if (algorithm !== "sha256" && algorithm !== "sha512") {
    throw new InvalidSriHashError("Unsupported SRI algorithm");
  }
  return algorithm;
}

function sriHashDigest(hash: SriHash): readonly number[] {
  const encoded = hash.slice(hash.indexOf("-") + 1);
  const decoded = globalThis.atob(encoded);
  const bytes: number[] = [];
  for (let index = 0; index < decoded.length; index += 1) {
    bytes.push(decoded.codePointAt(index) ?? 0);
  }
  return bytes;
}

export { InvalidSriHashError, formatSriHash, parseSriHash, sriHashAlgorithm, sriHashDigest };
export type { SriAlgorithm, SriHash };
