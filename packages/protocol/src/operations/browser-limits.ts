/**
 * The most characters of a page snapshot one `browser/run` answers, so a snapshot and its lines
 * about the tab fit in the 12,000 characters of a tool result (decision 0401).
 */
export const maxSnapshotChars: number = 9_000;

/** The most characters of a page's prose one `text` action answers. */
export const maxPageTextChars: number = 9_000;

/** The most characters of an `evaluate` result, as JSON text. */
export const maxValueChars: number = 4_000;

/** The most characters of the reason an action failed. */
export const maxProblemChars: number = 1_000;

/** The most console messages one answer carries, newest last. */
export const maxConsoleMessages: number = 50;

/** The most characters of one console message. */
export const maxConsoleTextChars: number = 300;

/** The most tabs one answer lists. */
export const maxTabs: number = 20;

/**
 * The longest wait or action time limit a call may ask for, in milliseconds: the engine answers a
 * call within 30 seconds.
 */
export const maxActionMs: number = 25_000;

/** The widest or tallest window `resize` takes, in pixels. */
export const maxWindowSide: number = 8_192;
