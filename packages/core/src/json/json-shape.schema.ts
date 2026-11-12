/** Why a JSON text's shape is refused before it is parsed. */
export type JsonShapeProblem = "too_deep" | "duplicate_key";

/**
 * The deepest nesting of objects and arrays binference reads from outside JSON (decision 0417).
 * Its own shapes nest at most 12 deep, frame included, and the recursive walks that read a value
 * run out of stack between 1,000 and 2,000 deep.
 */
export const maxJsonDepth = 64;

// The index of the quote that closes the string opened at `start`, or the text's end.
function stringEnd(text: string, start: number): number {
  let index = start + 1;
  while (index < text.length && text.charAt(index) !== '"') {
    index += text.charAt(index) === "\\" ? 2 : 1;
  }
  return index;
}

/**
 * Whether a JSON text nests objects and arrays deeper than `maxDepth`, read once with its strings
 * skipped and no recursion, so it is safe on any text before a parse or a walk (decision 0417).
 * Text that is not JSON is judged by its brackets outside quotes.
 */
export function nestsDeeperThan(text: string, maxDepth: number = maxJsonDepth): boolean {
  let depth = 0;
  for (let index = 0; index < text.length; index += 1) {
    const char = text.charAt(index);
    if (char === '"') {
      index = stringEnd(text, index);
    } else if (char === "{" || char === "[") {
      depth += 1;
      if (depth > maxDepth) {
        return true;
      }
    } else if (char === "}" || char === "]") {
      depth -= 1;
    }
  }
  return false;
}

/**
 * Whether a parsed value nests objects and arrays deeper than `maxDepth`, walked with a list in
 * place of recursion, so it is safe on any value before a schema or a walk reads it (decision
 * 0417). Bytes and other values count as leaves.
 */
export function valueNestsDeeperThan(value: unknown, maxDepth: number = maxJsonDepth): boolean {
  const pending: { readonly value: unknown; readonly depth: number }[] = [{ value, depth: 0 }];
  for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
    const held = next.value;
    if (held !== null && typeof held === "object" && !ArrayBuffer.isView(held)) {
      const depth = next.depth + 1;
      if (depth > maxDepth) {
        return true;
      }
      const children: readonly unknown[] = Array.isArray(held) ? held : Object.values(held);
      // One push each: a spread of a wide list would pass more arguments than a call takes.
      for (const child of children) {
        pending.push({ value: child, depth });
      }
    }
  }
  return false;
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
