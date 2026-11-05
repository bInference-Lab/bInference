import { createPreviewMessage, type PreviewMessage } from "./preview-message.js";
import { reasoningHtmlOf } from "./reasoning-html.js";
import type { StatusParts } from "./status-message.js";

/** The model's reasoning as it grows, in a message of its own beside the answer's preview. */
export interface ReasoningLane extends Pick<
  PreviewMessage,
  "freeze" | "remove" | "idle" | "close"
> {
  /** The reasoning so far, which replaces the one before. */
  take(text: string): void;
}

// The first send waits for this many characters of reasoning, as the answer's preview does.
const leastFirstChars = 30;

/**
 * Creates the reasoning lane of the `partial` reply mode with reasoning streamed (decision 0377):
 * its first page, under a bold title, shown once it holds 30 characters and edited at most once
 * a second; it is removed once the answer arrives, after it has shown for 4 seconds.
 */
export function createReasoningLane(parts: StatusParts, chatId: number): ReasoningLane {
  let reasoning = "";
  const firstPage = () => reasoningHtmlOf(parts.reasoningTitle(), reasoning)[0];
  const lane = createPreviewMessage(parts, { chatId, view: firstPage });
  return {
    freeze: async () => lane.freeze(),
    remove: async () => lane.remove(),
    idle: async () => lane.idle(),
    close: () => lane.close(),
    take(text) {
      reasoning = text;
      if (text.trim().length >= leastFirstChars) {
        lane.wake();
      }
    },
  };
}
