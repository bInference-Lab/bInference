/**
 * The index after the end of a string that opens at `start` with `quote`, a backslash escaping
 * the character after it, or `undefined` when the text ends inside the string.
 */
export function stringEnd(text: string, start: number, quote: string): number | undefined {
  let at = start + 1;
  while (at < text.length) {
    const char = text[at];
    if (char === "\\") {
      at += 2;
    } else if (char === quote) {
      return at + 1;
    } else {
      at += 1;
    }
  }
  return undefined;
}

/** Whether a character opens a string: a double quote, or a single quote before the repair. */
export function isQuote(char: string | undefined): char is '"' | "'" {
  return char === '"' || char === "'";
}
