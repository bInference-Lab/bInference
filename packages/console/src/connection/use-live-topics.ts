import type { PushTopic } from "@binference/protocol";
import { type QueryKey, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { useEngine } from "./engine-context";

// Each push topic the console follows, and the screens' queries a push of it makes stale.
const followed: readonly (readonly [PushTopic, QueryKey])[] = [
  ["intent", ["intents"]],
  ["ledger", ["ledger"]],
  ["ledger", ["portfolio"]],
  ["notice", ["limits"]],
  ["intent", ["webhookRules"]],
  ["ledger", ["webhookRules"]],
  ["notice", ["safety"]],
  ["intent", ["safety"]],
];

/**
 * Follows the engine's pushes while the console is open: a new card, a closed one or a ledger
 * entry loads the screens that show them again, a ledger entry the portfolio too, since a fill
 * or a send writes one, and a notice, such as a limit change, the limits. A card that closes or a
 * fill reloads the alert rules, whose state and fills they change. A notice or a card, such as a
 * freeze from Telegram or a rescue that moves on, reloads the safety screen.
 */
export function useLiveTopics(): void {
  const { topics } = useEngine();
  const queries = useQueryClient();
  useEffect(() => {
    const ends = followed.map(([topic, queryKey]) => {
      const stale = async (): Promise<void> => queries.invalidateQueries({ queryKey });
      return topics.listen(topic, { onPush: () => void stale(), refetch: stale });
    });
    return () => {
      ends.forEach((end) => end());
    };
  }, [topics, queries]);
}
