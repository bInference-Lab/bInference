import { useCallback } from "react";
import { useConsolePush } from "./console-push";

/** Whether a card is the one a notification opened, and the ref callback that shows it. */
export interface FocusedCard {
  readonly isFocused: boolean;
  /** Scrolls the card's element into view once it mounts. */
  readonly showIn: (element: HTMLElement | null) => void;
}

/**
 * Marks the intent's card when a notification opened it: `showIn` scrolls the card to the middle
 * of the view once it mounts.
 */
export function useFocusedCard(intent: string): FocusedCard {
  const isFocused = useConsolePush().focus === intent;
  const showIn = useCallback(
    (element: HTMLElement | null) => {
      if (isFocused) {
        element?.scrollIntoView({ block: "center" });
      }
    },
    [isFocused],
  );
  return { isFocused, showIn };
}
