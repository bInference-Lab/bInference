import type { EngineView } from "../contracts/turn-engine-contract.js";

/**
 * What one run of a helper did, as its turn told it (decision 0403): what the engine holds of an
 * agent's turn, kept here since no surface shows a helper's chat, for `helper_read` and the agent's
 * report. Its final text is `said`, its tools' lines `progressKeys`, newest last.
 */
export type HelperRunView = EngineView;

/** One run's log: read it whole, or change it as the turn goes. */
export interface HelperRunLog {
  read(): HelperRunView;
  write(change: (before: HelperRunView) => HelperRunView): void;
}

// How many of each list a run keeps: its newest lines are what a reader wants.
const keptLines = 50;

/** A list with one more item, keeping the newest {@link keptLines}. */
export function withLine(lines: readonly string[], line: string): readonly string[] {
  return [...lines, line].slice(-keptLines);
}

/** Creates the empty log of a run that has not started. */
export function createHelperRunLog(): HelperRunLog {
  let view: HelperRunView = {
    running: false,
    marked: false,
    said: [],
    statusKeys: [],
    drafts: [],
    progressKeys: [],
  };
  return {
    read: () => view,
    write(change) {
      view = change(view);
    },
  };
}
