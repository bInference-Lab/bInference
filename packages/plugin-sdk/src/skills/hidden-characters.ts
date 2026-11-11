// Characters that show nothing, or turn the text around them, so a reader sees other words than
// the model reads: zero-width and joiner characters, the soft hyphen, the bidirectional controls,
// the invisible operators, the interlinear annotation marks and the tag characters, as ranges of
// code points. A byte order mark as a file's first character is its encoding's mark and passes.
const hiddenRanges: readonly (readonly [number, number])[] = [
  [0xad, 0xad],
  [0x34f, 0x34f],
  [0x61c, 0x61c],
  [0x115f, 0x1160],
  [0x17b4, 0x17b5],
  [0x180e, 0x180e],
  [0x200b, 0x200f],
  [0x202a, 0x202e],
  [0x2060, 0x2064],
  [0x2066, 0x206f],
  [0xfeff, 0xfeff],
  [0xfff9, 0xfffb],
  [0xe0000, 0xe007f],
];

function isHidden(point: number): boolean {
  return hiddenRanges.some(([low, high]) => point >= low && point <= high);
}

/** One line of a text that holds a hidden character, with each made visible as `<U+XXXX>`. */
export interface HiddenLine {
  /** The line, from 1. */
  readonly line: number;
  readonly text: string;
}

// The line with each hidden character written out, or `undefined` when it holds none.
function visibleLine(line: string): string | undefined {
  let found = false;
  const shown = Array.from(line, (character) => {
    const point = character.codePointAt(0) ?? 0;
    if (!isHidden(point)) {
      return character;
    }
    found = true;
    return `<U+${point.toString(16).toUpperCase().padStart(4, "0")}>`;
  });
  return found ? shown.join("").trim() : undefined;
}

/**
 * The lines of a text that hold a character a reader cannot see or that reorders what it shows,
 * each with those characters written as `<U+XXXX>`, so whoever reviews the text sees them.
 */
export function hiddenLines(text: string): readonly HiddenLine[] {
  const body = text.startsWith("\uFEFF") ? text.slice(1) : text;
  return body.split("\n").flatMap((line, index) => {
    const shown = visibleLine(line);
    return shown === undefined ? [] : [{ line: index + 1, text: shown }];
  });
}
