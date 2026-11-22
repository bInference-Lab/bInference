import type { Transformer } from "grammy";

// The Bot API methods whose message may show a link preview (Bot API, `LinkPreviewOptions`).
const previewMethods: ReadonlySet<string> = new Set(["sendMessage", "editMessageText"]);

/**
 * A grammY transformer that turns link previews off on every message the bot sends or edits: a
 * card, a receipt, a notice or an answer shows its links as text, with no page's preview under
 * it. Every other call passes as it is.
 */
// grammY hands a transformer four arguments; a rest tuple keeps them typed together.
export const noLinkPreviews: Transformer = async (...call) => {
  const [prev, method, payload, signal] = call;
  const sent = previewMethods.has(method)
    ? { ...payload, link_preview_options: { is_disabled: true } }
    : payload;
  return prev(method, sent, signal);
};
