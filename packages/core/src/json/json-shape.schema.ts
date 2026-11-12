/** Why a JSON text's shape is refused before it is parsed. */
export type JsonShapeProblem = "too_deep" | "duplicate_key";

// The index of the quote that closes the string opened at `start`, or the text's end.
function stringEnd(text: string, start: number): number {
  let index = start + 1;
  while (index < text.length && text.charAt(index) !== '"') {
    index += text.charAt(index) === "\\" ? 2 : 1;
  }
  return index;
}

// A key is compared as JSON reads it, so `"ab"` and `"ab"` are one key.
function keyOf(literal: string): string {
  try {
    const key: unknown = JSON.parse(literal);
    return typeof key === "string" ? key : literal;
  } catch {
    return literal;
  }
}

// Adds a key to its object's keys; false when the object already had it.
function addKey(keys: Set<string>, literal: string): boolean {
  const key = keyOf(literal);
  const isNew = !keys.has(key);
  keys.add(key);
  return isNew;
}

/**
 * Scans a JSON text once, skipping strings, for what a parse would hide or could not survive:
 * brackets nested deeper than `maxDepth`, and a key written twice in one object, which a parse
 * resolves silently to its last value. Text that is not JSON is left for the parse to refuse.
 */
export function jsonShapeProblem(text: string, maxDepth: number): JsonShapeProblem | undefined {
  // One entry per open bracket: an object's keys so far, or none for an array.
  const open: (Set<string> | undefined)[] = [];
  let last = "";
  let index = 0;
  const readString = (): JsonShapeProblem | undefined => {
    const end = stringEnd(text, index);
    const keys = open.at(-1);
    const isKey = keys !== undefined && (last === "{" || last === ",");
    const literal = text.slice(index, end + 1);
    index = end;
    last = '"';
    return isKey && !addKey(keys, literal) ? "duplicate_key" : undefined;
  };
  const readStructure = (char: string): JsonShapeProblem | undefined => {
    if (char === "{" || char === "[") {
      open.push(char === "{" ? new Set() : undefined);
    } else if (char === "}" || char === "]") {
      open.pop();
    }
    last = "{[}],:".includes(char) ? char : last;
    return open.length > maxDepth ? "too_deep" : undefined;
  };
  for (; index < text.length; index += 1) {
    const char = text.charAt(index);
    const problem = char === '"' ? readString() : readStructure(char);
    if (problem !== undefined) {
      return problem;
    }
  }
  return undefined;
}
