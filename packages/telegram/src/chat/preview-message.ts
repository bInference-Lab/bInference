import { BinferenceError, type Clock } from "@binference/core";
import type { BotCalls } from "../ingress/bot-calls.js";
import type { ChatHtml } from "./chat-html.js";
import { type Preview, type PreviewParts, refreshPreview, type Showing } from "./preview-sends.js";

/** What a preview message needs: the preview's parts and the bot's calls. */
export interface PreviewMessageParts extends PreviewParts {
  readonly bot: BotCalls;
}

/**
 * One message of a running turn that is edited as the turn goes: shown once something wakes it,
 * then edited at most once a second while what it would show changes.
 */
export interface PreviewMessage {
  /** Shows the message now, unless it already shows. */
  wake(): void;
  /** Shows the message `delayMs` from now, unless it shows sooner. */
  wakeIn(delayMs: number): void;
  /** No edit follows, and the one under way is done: the message keeps what it showed. */
  freeze(): Promise<void>;
  /**
   * Replaces the message's words with `text`, as plain text. Answers whether it did: `false` when
   * no message showed or the edit failed.
   */
  replaceWith(text: string, signal: AbortSignal): Promise<boolean>;
  /** Deletes the message once it has shown for 4 seconds; resolves once it is gone or left. */
  remove(): Promise<void>;
  /** Where the message stands now. */
  current(): Showing;
  /** Resolves once no send, edit or removal is under way. */
  idle(): Promise<void>;
  /** Ends every wait: a removal that waits for its time goes at once. */
  close(): void;
}

// Telegram's own guidance: about one message a second in a chat; edits count too.
const refreshMs = 1_000;
// A preview stays this long once it showed, so it never flashes and goes.
const leastShownMs = 4_000;

function codeOf(error: ErrorOptions["cause"]): string {
  return error instanceof BinferenceError ? error.code : "unexpected";
}

// Sleeps until the wait ends or a signal aborts, or with no wait until a signal aborts; answers
// whether `stop`, the first signal, is still not aborted.
async function waited(clock: Clock, waitMs: number | undefined, signals: readonly AbortSignal[]) {
  const [stop] = signals;
  const any = AbortSignal.any([...signals]);
  try {
    await (waitMs === undefined
      ? new Promise((_resolve, reject) => {
          any.addEventListener("abort", () => reject(new Error("woken")), { once: true });
          any.throwIfAborted();
        })
      : clock.sleep(Math.max(0, waitMs), any));
  } catch {
    return stop?.aborted !== true;
  }
  return true;
}

// The message goes once it has shown for 4 seconds, or at once after a close; one Telegram no
// longer has counts as gone, and any other failure leaves it, logged.
async function removeOnceShown(parts: PreviewMessageParts, preview: Preview): Promise<void> {
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
  parts: PreviewMessageParts,
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

/** Where a preview stands, as its parts read and change it. */
interface ShowingCell {
  get(): Showing;
  set(next: Showing): void;
}

/** The refresh loop of one message: its wakes, its freeze, the refresh under way. */
interface RefreshLoop {
  /** Moves the first showing to `atMs`, when that is sooner. */
  wakeAt(atMs: number): void;
  freeze(): Promise<void>;
  refreshing(): Promise<void>;
}

// Each turn of the loop waits, then refreshes once: the first showing once its wake time comes,
// then one refresh a second, until it stops.
function startRefreshLoop(preview: () => Preview, cell: ShowingCell): RefreshLoop {
  const stop = new AbortController();
  const wakes = { current: new AbortController(), atMs: Number.POSITIVE_INFINITY };
  const under = { refresh: Promise.resolve() };
  const { clock } = preview().parts;
  const isShown = (): boolean => cell.get().messageId !== undefined;
  const untilShown = async (): Promise<boolean> => {
    while (!isShown() && clock.now() < wakes.atMs) {
      wakes.current = new AbortController();
      const waitMs = Number.isFinite(wakes.atMs) ? wakes.atMs - clock.now() : undefined;
      // oxlint-disable-next-line eslint/no-await-in-loop -- a wake moves the wait, one at a time
      if (!(await waited(clock, waitMs, [stop.signal, wakes.current.signal]))) {
        return false;
      }
    }
    return true;
  };
  const waitForTurn = async (): Promise<boolean> => {
    const ready = isShown() ? await waited(clock, refreshMs, [stop.signal]) : await untilShown();
    return ready && !cell.get().isDone;
  };
  const run = async (): Promise<void> => {
    // oxlint-disable-next-line eslint/no-await-in-loop -- one wait, then one refresh, at a time
    while (await waitForTurn()) {
      under.refresh = (async () => {
        const change = await refreshPreview(preview());
        cell.set({ ...cell.get(), ...change });
        // A first send that did not show tries again in a second while there is something to
        // show; with nothing to show yet, it waits for the next wake.
        const hasView = preview().view() !== undefined;
        wakes.atMs = hasView ? clock.now() + refreshMs : Number.POSITIVE_INFINITY;
      })();
      // oxlint-disable-next-line eslint/no-await-in-loop -- one refresh at a time
      await under.refresh;
    }
  };
  void run();
  return {
    // Once the message shows, a change waits for the next refresh: edits stay a second apart.
    wakeAt: (atMs) => {
      if (!isShown() && atMs < wakes.atMs) {
        wakes.atMs = atMs;
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

/**
 * Creates a preview message for the owner's chat that shows what `view` gives (decision 0371):
 * nothing until a wake, then every second while it changes. Its sends and edits are previews the
 * throttler drops rather than queue; HTML Telegram cannot read goes as plain text.
 */
export function createPreviewMessage(
  parts: PreviewMessageParts,
  place: { readonly chatId: number; readonly view: () => ChatHtml | undefined },
): PreviewMessage {
  const life = new AbortController();
  let showing: Showing = { failures: 0, isDone: false };
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
    wake: () => loop.wakeAt(parts.clock.now()),
    wakeIn: (delayMs) => loop.wakeAt(parts.clock.now() + delayMs),
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
    current: () => showing,
    idle: async () => {
      await Promise.all([loop.refreshing(), removing]);
    },
    close() {
      life.abort();
      void loop.freeze();
    },
  };
}
