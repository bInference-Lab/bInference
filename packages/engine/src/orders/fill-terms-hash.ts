import type { Id } from "@binference/core";
import { stableJson } from "@binference/core";
import type { IntentSnapshot } from "../intents/create-stored-intents.js";
import type { IntentRecord } from "../intents/intent-record.js";
import type { IntentStore } from "../ports.js";
import { type Sha256Hex, sha256Hex } from "../records/sha256-hex.js";
import type { OrderRecord } from "./order-record.js";

/** What binds a fill to its order: the order, its confirmed card's terms and its fills before. */
export interface FillTermsBinding {
  readonly order: Id<"ord">;
  readonly orderTermsHash: string;
  readonly fillsBefore: number;
}

/**
 * The terms hash of an auto order's fill (decisions 0210 and 0211): the SHA-256 of a tagged,
 * versioned document of the intent's id, its order with the terms hash of the order's confirmed
 * card and the fills the order had before the fill, the request, the quote and the plan. It is
 * stored with the fill's authorization as the fill is confirmed, and the wallet queue signs only
 * while the fill as it reads it hashes to it again.
 */
export function fillTermsHash(
  record: Pick<IntentRecord, "id" | "request" | "quote" | "plan">,
  binding: FillTermsBinding,
): Sha256Hex {
  const terms = {
    v: 1,
    kind: "orderFill",
    intent: record.id,
    order: binding.order,
    orderTermsHash: binding.orderTermsHash,
    fillsBefore: binding.fillsBefore,
    request: record.request,
    quote: record.quote ?? null,
    plan: record.plan ?? null,
  };
  return sha256Hex(stableJson(terms));
}

/**
 * The terms hash of a fill as its money path proposed it (decision 0211), bound to its order's
 * confirmed card and the fills the order has now; none when the order's card holds no
 * confirmation.
 */
export async function proposedTermsHash(
  intents: Pick<IntentStore, "confirmation">,
  call: {
    readonly order: OrderRecord;
    readonly simulated: IntentSnapshot;
    readonly signal: AbortSignal;
  },
): Promise<string | undefined> {
  const { order, simulated, signal } = call;
  const card = await intents.confirmation(order.intentId, { signal });
  if (card === undefined) {
    return undefined;
  }
  const binding = { order: order.id, orderTermsHash: card.termsHash, fillsBefore: order.fills };
  return fillTermsHash(simulated.record, binding);
}
