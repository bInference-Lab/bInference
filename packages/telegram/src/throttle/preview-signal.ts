// The signals of preview calls: a status message's edit that the next one replaces. A WeakSet
// holds them, so a call's signal says what it is and a finished call leaves nothing behind.
const previews = new WeakSet<object>();

/**
 * A signal that marks a Bot API call as a preview, aborted with `signal`. The bot's throttler
 * drops a preview rather than wait for it: one that would queue behind another call of its chat,
 * that meets a wait Telegram asked for, or that Telegram answers with a 429 rejects with
 * `telegram.preview_dropped` and is never sent again.
 */
export function previewSignal(signal: AbortSignal): AbortSignal {
  const marked = AbortSignal.any([signal]);
  previews.add(marked);
  return marked;
}

/** Whether a call's signal marks it as a preview. */
export function isPreviewSignal(signal: object | undefined): boolean {
  return signal !== undefined && previews.has(signal);
}
