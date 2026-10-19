import { styleText } from "node:util";
import type { ChatTerminal } from "./chat-terminal.js";
import { fitWidth } from "./fit-width.js";

/** How a line stands out: dim for the chat's own words, bold for a header, yellow for a card. */
type Tone = "dim" | "bold" | "yellow";

/** One line of the screen: its text, and how it stands out. */
interface ScreenLine {
  readonly text: string;
  readonly tone?: Tone;
}

/**
 * The chat's screen: lines printed for good above, and a live area of a few rows at the bottom
 * that is drawn again on each change, with the line the owner types last.
 */
export interface ChatScreen {
  /** Prints lines above the live area, where the terminal keeps them as it scrolls. */
  print(lines: readonly ScreenLine[]): void;
  /** Draws the live area again with these rows, each cut to the terminal's width. */
  show(rows: readonly ScreenLine[]): void;
  /** Clears the live area and leaves the cursor at the start of a new line. */
  close(): void;
}

// Control sequences: the start of the line, one row up, and the screen cleared below the cursor.
const lineStart = "\r";
const rowUp = "\u001b[1A";
const clearBelow = "\u001b[J";

/**
 * Creates the chat's screen on the terminal's output. Every live row is cut one column short of
 * the terminal's width, so no row wraps, and the area always takes as many rows as it shows: at
 * most the terminal's height less one, the newest rows kept. Tones show only on a terminal that
 * takes colors (`NO_COLOR` turns them off).
 */
export function createChatScreen(terminal: Pick<ChatTerminal, "output" | "size">): ChatScreen {
  const { output } = terminal;
  const state: { drawn: number; rows: readonly ScreenLine[] } = { drawn: 0, rows: [] };
  const styled = (line: ScreenLine, text: string): string =>
    line.tone === undefined ? text : styleText(line.tone, text, { stream: output });
  const erase = (): string =>
    state.drawn === 0 ? "" : `${lineStart}${rowUp.repeat(state.drawn - 1)}${clearBelow}`;
  const draw = (): string => {
    const { columns, rows } = terminal.size();
    const shown = state.rows.slice(-Math.max(1, rows - 1));
    state.drawn = shown.length;
    return shown.map((row) => styled(row, fitWidth(row.text, Math.max(1, columns - 1)))).join("\n");
  };
  return {
    print: (lines) => {
      const printed = lines.map((line) => `${styled(line, line.text)}\n`).join("");
      output.write(`${erase()}${printed}${draw()}`);
    },
    show: (rows) => {
      const cleared = erase();
      state.rows = rows;
      output.write(`${cleared}${draw()}`);
    },
    close: () => {
      const cleared = erase();
      state.drawn = 0;
      state.rows = [];
      output.write(cleared);
    },
  };
}
