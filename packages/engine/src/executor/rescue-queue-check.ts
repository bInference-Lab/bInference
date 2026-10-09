import type { Clock } from "@binference/core";
import type { IntentSnapshot } from "../intents/create-stored-intents.js";
import { rescueQuoteDocument } from "../intents/rescue-quote.js";
import { rescueAt } from "../policy/rescue-change.js";
import type { InstallStore, IntentStore } from "../ports.js";
import { confirmationTerms, type QueueCheck } from "./queue-check.js";

/** What the queue check of a rescue reads: its confirmation, the install's address, the time. */
export interface RescueQueueParts {
  readonly intents: IntentStore;
  readonly install: InstallStore;
  readonly clock: Clock;
}

/**
 * Reads what the wallet queue checks as it takes a confirmed rescue (spec 6, `queue_took`): the
 * owner's confirmation, and the policy again, which passes while the address the card confirmed is
 * still the rescue address in effect (decision 0110); an agent's mode never counts (decision
 * 0100). The signer may send to that address alone, and to no contract or spender.
 */
export async function checkRescueForQueue(
  snapshot: IntentSnapshot,
  parts: RescueQueueParts,
  signal: AbortSignal,
): Promise<QueueCheck> {
  const { record, stored, settings } = snapshot;
  const quote = record.quote === undefined ? undefined : rescueQuoteDocument.decode(record.quote);
  const facts = await parts.install.read({ signal });
  const inEffect = rescueAt(facts, parts.clock.now()).rescueAddress;
  const terms = await confirmationTerms(snapshot, parts, signal);
  const { confirmation } = stored;
  return {
    facts: {
      isAgentLive: settings.agent.mode === "live",
      hasPolicyPassed: quote !== undefined && inEffect === quote.rescue,
      ...(confirmation === undefined ? {} : { confirmation }),
    },
    isAuto: false,
    ...(terms === undefined || quote === undefined
      ? {}
      : {
          terms: { ...terms, allowed: { contracts: [], spenders: [], recipients: [quote.rescue] } },
        }),
  };
}
