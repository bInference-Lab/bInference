import type { Clock } from "@binference/core";
import type { StoredIntents } from "../intents/create-stored-intents.js";
import type { IntentQuery } from "../intents/intent-change.js";
import type { IntentRecord } from "../intents/intent-record.js";
import { statesBeforeCard } from "../intents/transition-table.js";
import { cancelUnsigned } from "../orders/cancel-order.js";
import type { OrderParts } from "../orders/create-order.js";
import { followOrderCard } from "../orders/follow-order-card.js";
import { followRuleCard } from "../webhooks/follow-rule-card.js";
import type { WebhookRuleParts } from "../webhooks/webhook-rule-parts.js";

/**
 * What the start's end of the proposals a stop left reads and writes through, with the auto
 * orders and webhook rules whose cards it ends.
 */
export interface UnfinishedProposalParts {
  readonly stored: StoredIntents;
  readonly clock: Clock;
  readonly orders: OrderParts;
  readonly rules: WebhookRuleParts;
}

const pageSize = 100;

// An intent the engine proposed is a fill, which its own repair ends with its order's or rule's
// row (decisions 0210 and 0338); a token launch past `proposed` is its pin check's, which carries
// it across a stop and tells the owner when it ends (decision 0237).
function isLeftToItsRepair(record: IntentRecord): boolean {
  return (
    record.proposer === "engine" || (record.kind === "launchToken" && record.state !== "proposed")
  );
}

// An auto order's or a webhook rule's card ends its order or rule, as a denied or expired card
// does (decisions 0189 and 0299); any other card holds nothing.
async function followHolder(
  parts: UnfinishedProposalParts,
  record: IntentRecord,
  signal: AbortSignal,
): Promise<void> {
  if (record.kind === "autoOrder") {
    await followOrderCard(parts.orders, record.id, signal);
  }
  if (record.kind === "webhookRule") {
    await followRuleCard(parts.rules, record.id, signal);
  }
}

// Cancels a page's intents one at a time, each with the order or rule its card holds, and answers
// how many it cancelled.
async function endEach(
  parts: UnfinishedProposalParts,
  page: readonly IntentRecord[],
  signal: AbortSignal,
): Promise<number> {
  const left = page.filter((record) => !isLeftToItsRepair(record));
  return left.reduce<Promise<number>>(async (counted, record) => {
    const count = await counted;
    const cancel = { intent: record.id, cause: "engine_stopping" } as const;
    if (!(await cancelUnsigned(parts, cancel, signal))) {
      return count;
    }
    await followHolder(parts, record, signal);
    return count + 1;
  }, Promise.resolve(0));
}

// One page at a time, the least recently changed first: a cancelled intent leaves the states it
// reads, and the next page starts after the last intent this one read.
async function endFrom(
  parts: UnfinishedProposalParts,
  signal: AbortSignal,
  after?: IntentQuery["after"],
): Promise<number> {
  const query = { states: statesBeforeCard, limit: pageSize };
  const page = await parts.stored.list(after === undefined ? query : { ...query, after }, {
    signal,
  });
  const ended = await endEach(parts, page, signal);
  const last = page.at(-1);
  if (page.length < pageSize || last === undefined) {
    return ended;
  }
  return ended + (await endFrom(parts, signal, { changedAtMs: last.changedAtMs, id: last.id }));
}

/**
 * The start's end of every proposal a stop left before its card (decision 0444): each intent in
 * `proposed`, `checked`, `quoted`, `assessed` or `simulated`, live or paper, moves to `cancelled`
 * as `engine_stopping`, one at a time, through the state machine. Nothing of it was signed and no
 * card of it was shown, so no notice goes out; an auto order or a webhook rule whose card it ends
 * ends with it. A fill and a token launch past `proposed` are left to their own repairs. Only the start calls it, before the queue takes any intent and before any
 * order runs; a lost lease stops it where it stands. Answers how many intents it ended.
 */
export async function endUnfinishedProposals(
  parts: UnfinishedProposalParts,
  options: { readonly signal: AbortSignal },
): Promise<number> {
  return endFrom(parts, options.signal);
}
