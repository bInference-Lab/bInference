import { createHash } from "node:crypto";

const tokenPattern = /[A-Za-z0-9_]+(?:[.-][A-Za-z0-9_]+)*/g;
const camelBoundary = /(?<=[a-z0-9])(?=[A-Z])/;

function hash(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

// A token counts whole, by its dotted or dashed parts, and by its camelCase parts, so a
// reserved word is found inside a file name, an identifier or a sentence alike.
function candidates(token: string): readonly string[] {
  const parts = token.split(/[._-]/);
  const camelParts = parts.flatMap((part) => part.split(camelBoundary));
  return [token, ...parts, ...camelParts].map((part) => part.toLowerCase());
}

function wordPairs(line: string): readonly string[] {
  const words = line.toLowerCase().match(/[a-z]+/g) ?? [];
  return words.slice(1).map((word, index) => `${words[index] ?? ""} ${word}`);
}

/** Finds reserved names in text by comparing SHA-256 hashes, so the names stay unwritten. */
export function createReservedCheck(reserved: ReadonlySet<string>): (line: string) => string[] {
  const seen = new Map<string, boolean>();
  const isReserved = (text: string): boolean => {
    const known = seen.get(text);
    if (known !== undefined) {
      return known;
    }
    const result = reserved.has(hash(text));
    seen.set(text, result);
    return result;
  };
  return (line) => {
    const tokens = (line.match(tokenPattern) ?? []).flatMap(candidates);
    const found = [...tokens, ...wordPairs(line)].filter(isReserved);
    return [...new Set(found.map(hash))];
  };
}
