import type { ModelEvent } from "./model-event.js";
import { splitReasoningTags } from "./reasoning-tags.js";

/** What changed of a response so far with one event: the text the owner may read, the reasoning. */
interface HeardChange {
  readonly text?: string;
  readonly reasoning?: string;
}

/** A streamed response so far, as a surface may show it while the model writes. */
export interface ResponseSoFar {
  /** Takes one event; answers the text or the reasoning so far that it changed. */
  take(event: ModelEvent): HeardChange;
}

/**
 * Follows a response as it streams: its text outside reasoning tags, and its reasoning, the
 * reasoning events' first and then what the text holds inside tags. A text piece with no `<` or
 * backtick, while no section or tag is open, only adds to what shows; any other piece reads the
 * whole text again, since it may open, close or quote a section.
 */
export function createResponseSoFar(): ResponseSoFar {
  let [raw, shown, tagged, native, isOpen] = ["", "", "", "", false];
  const reasoning = (): string => [native, tagged].filter((part) => part !== "").join("\n\n");
  const takeText = (delta: string): HeardChange => {
    raw += delta;
    const [before, taggedBefore] = [shown, tagged];
    if (!isOpen && !/[<`]/u.test(delta)) {
      shown += delta;
    } else {
      ({ text: shown, reasoning: tagged, isOpen } = splitReasoningTags(raw, { isFinal: false }));
    }
    return {
      ...(shown === before ? {} : { text: shown }),
      ...(tagged === taggedBefore ? {} : { reasoning: reasoning() }),
    };
  };
  return {
    take(event) {
      if (event.type === "text") {
        return takeText(event.delta);
      }
      if (event.type !== "reasoning" || event.delta === "") {
        return {};
      }
      native += event.delta;
      return { reasoning: reasoning() };
    },
  };
}
