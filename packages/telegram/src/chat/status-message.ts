import { BinferenceError, type Clock } from "@binference/core";
import type { BotCalls } from "../ingress/bot-calls.js";
import { type Preview, type PreviewParts, refreshPreview, type Showing } from "./preview-sends.js";
import { compactLine, maxLineChars, maxNarrationChars, withLine } from "./progress-lines.js";
import type { WorkLine } from "./status-preview.js";

/** What a status message needs: the preview's parts and the bot's calls. */
export interface StatusParts extends PreviewParts {
  readonly bot: BotCalls;
}

/**
 * One turn's status message in the owner's chat (decision 0371): it first shows 1.5 seconds into
 * the turn, or at once for a tool's line, so a quick answer shows none; then it is edited at most
 * once a second with how long the agent has worked, the tools it ran and the text it writes.
 */
export interface StatusMessage {
  /** The text the agent writes now. */
  draft(text: string): void;
  /** A tool the turn runs, in the bot's words; the text written before it becomes a work line. */
  work(toolLine: string): void;
  /** No edit follows, and the one under way is done: the message keeps what it showed. */
  freeze(): Promise<void>;
  /**
   * Replaces the message's words with `text`, as plain text. Answers whether it did: `false` when
   * no message showed or the edit failed.
   */
  replaceWith(text: string, signal: AbortSignal): Promise<boolean>;
  /** Deletes the message once it has shown for 4 seconds; resolves once it is gone or left. */
  remove(): Promise<void>;
  /** Resolves once no send, edit or removal is under way. */
  idle(): Promise<void>;
  /** Ends every wait: a removal that waits for its time goes at once. */
  close(): void;
}

// The first showing waits this long, so a quick answer posts no status message at all.
const initialDelayMs = 1_500;
// Telegram's own guidance: about one message a second in a chat; edits count too.
const refreshMs = 1_000;
// A status message stays this long once it showed, so it never flashes and goes.
const leastShownMs = 4_000;

function codeOf(error: ErrorOptions["cause"]): string {
  return error instanceof BinferenceError ? error.code : "unexpected";
}

// Sleeps until the wait ends or a signal aborts; answers whether `stop` is still not aborted.
async function waited(clock: Clock, waitMs: number, signals: readonly AbortSignal[]) {
  const [stop] = signals;
  try {
    await clock.sleep(Math.max(0, waitMs), AbortSignal.any([...signals]));
  } catch {
    return stop?.aborted !== true;
  }
  return true;
}

// The work lines once a tool follows the draft: the draft as one line, then the tool's.
function linesWith(showing: Showing, toolLine: string): readonly WorkLine[] {
  const narration = compactLine(showing.draft ?? "", maxNarrationChars);
  const told = withLine(showing.lines, { kind: "narration", text: narration });
  return withLine(told, { kind: "tool", text: compactLine(toolLine, maxLineChars) });
}

// The message goes once it has shown for 4 seconds, or at once after a close; one Telegram no
// longer has counts as gone, and any other failure leaves it, logged.
async function removeOnceShown(parts: StatusParts, preview: Preview): Promise<void> {
  const { messageId, visibleAtMs = 0 } = preview.showing;
  if (messageId === undefined) {
    return;
  }
  const { clock, logger, bot } = parts;
  await waited(clock, visibleAtMs + leastShownMs - clock.now(), [preview.life]);
  // The delete outlives a close of the replies; the throttler bounds each attempt.
  try {
    await bot.deleteMessage(preview.chatId, messageId, { signal: new AbortController().signal });
  } catch (error) {
    logger.info("telegram.status_not_removed", { errorCode: codeOf(error) });
  }
}

async function replaced(
  parts: StatusParts,
  preview: Preview,
  words: { readonly text: string; readonly signal: AbortSignal },
): Promise<boolean> {
  const { messageId } = preview.showing;
  if (messageId === undefined) {
    return false;
  }
  try {
    await parts.bot.edit({ chatId: preview.chatId, messageId }, words.text, words);
    return true;
  } catch (error) {
    parts.logger.info("telegram.status_not_replaced", { errorCode: codeOf(error) });
    return false;
  }
}

/** Where a status message stands, as its parts read and change it. */
interface ShowingCell {
  get(): Showing;
  set(next: Showing): void;
}

/** The refresh loop of one message: its wake, its freeze, the refresh under way. */
interface RefreshLoop {
  /** Ends the wait for the first showing, so the message shows now. */
  wake(): void;
  freeze(): Promise<void>;
  refreshing(): Promise<void>;
}

// Each turn of the loop waits, then refreshes once: the first showing at its delay or a wake,
// then one refresh a second, until it stops.
function startRefreshLoop(preview: () => Preview, cell: ShowingCell): RefreshLoop {
  const stop = new AbortController();
  const wakes = { current: new AbortController() };
  const under = { refresh: Promise.resolve() };
  const { parts, startedAtMs } = preview();
  const tried = { refreshes: 0 };
  const nextWaitMs = (): number =>
    tried.refreshes === 0 ? startedAtMs + initialDelayMs - parts.clock.now() : refreshMs;
  const refresh = async (): Promise<void> => {
    tried.refreshes += 1;
    const change = await refreshPreview(preview());
    cell.set({ ...cell.get(), ...change });
  };
  const waitForTurn = async (): Promise<boolean> => {
    wakes.current = new AbortController();
    const signals = [stop.signal, wakes.current.signal];
    return !cell.get().isDone && (await waited(parts.clock, nextWaitMs(), signals));
  };
  const run = async (): Promise<void> => {
    // oxlint-disable-next-line eslint/no-await-in-loop -- one wait, then one refresh, at a time
    while (await waitForTurn()) {
      under.refresh = refresh();
      // oxlint-disable-next-line eslint/no-await-in-loop -- one refresh at a time
      await under.refresh;
    }
  };
  void run();
  return {
    // Once the message shows, a line waits for the next refresh: edits stay a second apart.
    wake: () => {
      if (cell.get().messageId === undefined) {
        wakes.current.abort();
      }
    },
    freeze: async () => {
      cell.set({ ...cell.get(), isDone: true });
      stop.abort();
      await under.refresh;
    },
    refreshing: async () => under.refresh,
  };
}

/** Creates the status message of a turn that started at `startedAtMs`, for the owner's chat. */
export function createStatusMessage(
  parts: StatusParts,
  place: { readonly chatId: number; readonly startedAtMs: number },
): StatusMessage {
  const life = new AbortController();
  let showing: Showing = { lines: [], failures: 0, isDone: false };
  let removing = Promise.resolve();
  const cell: ShowingCell = {
    get: () => showing,
    set: (next) => {
      showing = next;
    },
  };
  const preview = (): Preview => ({ parts, ...place, showing, life: life.signal });
  const loop = startRefreshLoop(preview, cell);
  return {
    draft(text) {
      showing = { ...showing, draft: text };
    },
    work(toolLine) {
      const { draft: _told, ...rest } = showing;
      showing = { ...rest, lines: linesWith(showing, toolLine) };
      loop.wake();
    },
    freeze: async () => loop.freeze(),
    replaceWith: async (text, signal) => {
      await loop.freeze();
      return replaced(parts, preview(), { text, signal });
    },
    remove: async () => {
      await loop.freeze();
      removing = removeOnceShown(parts, preview());
      await removing;
    },
    idle: async () => {
      await Promise.all([loop.refreshing(), removing]);
    },
    close() {
      life.abort();
      void loop.freeze();
    },
  };
}
