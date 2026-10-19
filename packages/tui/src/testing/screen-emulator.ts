/** What a terminal shows after the chat's writes: every row, scrolled-off ones first. */
export interface ScreenEmulator {
  /** Takes what the chat wrote. */
  write(text: string): void;
  /** Every row the terminal shows or scrolled off, top first. */
  rows(): readonly string[];
}

// The sequences the chat writes: one row up, clear below, and bracketed paste on and off.
const rowUp = "\u001b[1A";
const clearBelow = "\u001b[J";
const sequences = [rowUp, clearBelow, "\u001b[?2004h", "\u001b[?2004l"];

/**
 * A terminal of unbounded width that understands only what the chat's screen writes: text, a new
 * line, the start of the line, one row up, clear below, and the paste mode switches.
 */
export function createScreenEmulator(): ScreenEmulator {
  const rows: string[] = [""];
  let row = 0;
  const control = (code: string): void => {
    if (code === rowUp) {
      row = Math.max(0, row - 1);
    } else if (code === clearBelow) {
      rows.splice(row + 1);
      rows[row] = "";
    }
  };
  const character = (char: string): void => {
    if (char === "\n") {
      row += 1;
      rows[row] = rows[row] ?? "";
    } else if (char !== "\r") {
      rows[row] = `${rows[row] ?? ""}${char}`;
    }
  };
  return {
    write: (text) => {
      let at = 0;
      while (at < text.length) {
        const code = sequences.find((each) => text.startsWith(each, at));
        if (code === undefined) {
          character(text.charAt(at));
          at += 1;
        } else {
          control(code);
          at += code.length;
        }
      }
    },
    rows: () => [...rows],
  };
}
