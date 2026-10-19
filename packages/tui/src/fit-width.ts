import stringWidth from "string-width";

const ellipsis = "…";

// The columns each character takes, one code point at a time. A joined emoji counts once per part,
// so a row can come out shorter than the terminal, never longer.
function widths(text: string): readonly { readonly character: string; readonly width: number }[] {
  return Array.from(text, (character) => ({ character, width: stringWidth(character) }));
}

/**
 * The text cut to fit `columns` terminal columns, ending with `…` when cut. Wide characters, such
 * as Chinese, take two columns each.
 */
export function fitWidth(text: string, columns: number): string {
  if (stringWidth(text) <= columns) {
    return text;
  }
  let used = stringWidth(ellipsis);
  let kept = "";
  for (const { character, width } of widths(text)) {
    if (used + width > columns) {
      break;
    }
    used += width;
    kept += character;
  }
  return `${kept}${ellipsis}`;
}

/**
 * The end of the text that fits `columns` terminal columns, starting with `…` when cut: the line
 * the owner types shows its newest characters.
 */
export function tailWidth(text: string, columns: number): string {
  if (stringWidth(text) <= columns) {
    return text;
  }
  let used = stringWidth(ellipsis);
  const kept: string[] = [];
  for (const { character, width } of widths(text).toReversed()) {
    if (used + width > columns) {
      break;
    }
    used += width;
    kept.unshift(character);
  }
  return `${ellipsis}${kept.join("")}`;
}
