import type { Readable, Writable } from "node:stream";

/** The terminal's size in character cells. */
export interface TerminalSize {
  readonly columns: number;
  readonly rows: number;
}

/**
 * The terminal terminal chat runs in: the keys the person presses, the screen it writes to, and
 * its size. The CLI's entry file fills it from standard input and output when both are a terminal.
 */
export interface ChatTerminal {
  readonly input: Readable;
  readonly output: Writable;
  /** Turns raw mode on, so each key arrives as it is pressed. */
  readonly enterRawMode: () => void;
  /** Gives the terminal its line mode back. */
  readonly leaveRawMode: () => void;
  readonly size: () => TerminalSize;
  /** Calls `listener` each time the terminal is resized; answers how to stop. */
  readonly onResize: (listener: () => void) => () => void;
}
