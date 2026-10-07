// Characters a reader cannot see or that move other text: controls, formats such as bidi
// overrides and zero-width characters, lone surrogates, and line or paragraph separators.
const hidden = /[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}]/u;

function codePointText(character: string): string {
  const point = character.codePointAt(0) ?? 0;
  return `\\u{${point.toString(16).toUpperCase()}}`;
}

/**
 * Shows text set outside binference, such as a token's symbol or name, the agent's reason or a
 * venue's name (spec 4, section 1): longer than `maxCharacters` code points, it is cut and ends
 * with `…`; every character a reader cannot see, or that turns text around, shows as `\u{…}`.
 * The result is plain text: escape it for the surface after the message is filled in.
 */
export function displayOutsideText(text: string, maxCharacters: number): string {
  const characters = Array.from(text);
  const kept =
    characters.length > maxCharacters
      ? [...characters.slice(0, maxCharacters - 1), "…"]
      : characters;
  return kept
    .map((character) => (hidden.test(character) ? codePointText(character) : character))
    .join("");
}
