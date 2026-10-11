import type { Clock } from "@binference/core";
import type { IntentSnapshot } from "../intents/create-stored-intents.js";
import type { IntentRecord } from "../intents/intent-record.js";
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
 * Whether the address a rescue's card confirmed is still the rescue address in effect (decision
 * 0110): each of its steps sends there, so none signs once the address changed.
 */
export async function isRescueAddressInEffect(
  record: IntentRecord,
  parts: Pick<RescueQueueParts, "install" | "clock">,
  signal: AbortSignal,
): Promise<boolean> {
  const quote = record.quote === undefined ? undefined : rescueQuoteDocument.decode(record.quote);
  const facts = await parts.install.read({ signal });
  return quote !== undefined && rescueAt(facts, parts.clock.now()).rescueAddress === quote.rescue;
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
  const hasPolicyPassed = await isRescueAddressInEffect(record, parts, signal);
  const terms = await confirmationTerms(snapshot, parts, signal);
  const { confirmation } = stored;
  return {
    facts: {
      isAgentLive: settings.agent.mode === "live",
      hasPolicyPassed,
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
