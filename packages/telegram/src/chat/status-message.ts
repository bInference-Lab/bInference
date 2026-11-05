import {
  createPreviewMessage,
  type PreviewMessage,
  type PreviewMessageParts,
} from "./preview-message.js";
import { compactLine, maxLineChars } from "./progress-lines.js";
import { statusPreviewOf } from "./status-preview.js";

/** What a status message needs: the preview message's parts and its label. */
export interface StatusParts extends PreviewMessageParts {
  /** The fixed label, such as "Working", in the owner's language now. */
  readonly label: () => string;
}

/**
 * One turn's status message in the owner's chat (decision 0375): nothing while the agent only
 * writes its answer, so a plain answer shows the typing indicator alone; it shows at once when
 * a tool starts, with a fixed label, or in its place the text the agent wrote before its latest
 * tool, and is edited at most once a second when that changes.
 */
export interface StatusMessage extends Omit<PreviewMessage, "wake" | "wakeIn" | "current"> {
  /** The text the agent writes now; it shows only once a tool follows it. */
  draft(text: string): void;
  /** A tool of the turn starts: the message shows now, the text written before it as headline. */
  work(): void;
}

/** Creates the status message of a turn, for the owner's chat. */
export function createStatusMessage(parts: StatusParts, chatId: number): StatusMessage {
  let [draft, headline] = ["", ""];
  const view = () =>
    statusPreviewOf({ label: parts.label(), ...(headline === "" ? {} : { headline }) });
  const message = createPreviewMessage(parts, { chatId, view });
  return {
    freeze: async () => message.freeze(),
    replaceWith: async (text, signal) => message.replaceWith(text, signal),
    remove: async () => message.remove(),
    idle: async () => message.idle(),
    close: () => message.close(),
    draft(text) {
      draft = text;
    },
    work() {
      const said = compactLine(draft, maxLineChars);
      headline = said === "" ? headline : said;
      message.wake();
    },
  };
}
