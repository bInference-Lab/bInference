import assert from "node:assert/strict";
import type { Id } from "@binference/core";
import type { OrderRequest } from "@binference/protocol";
import { testToken } from "../intents/test-intents.js";
import type { OrderDraft, OrderMove } from "../orders/order-record.js";
import type { OrderStore } from "../orders/ports.js";
import type { AgentStore, IntentStore } from "../ports.js";
import { cardOf, confirmationOf, intentDraft, intentMove } from "./intent-fixtures.js";
import { fixtureId, live } from "./store-fixtures.js";

/** An agent and one wallet of it that exist in the subject's database. */
export interface PlantedPair {
  readonly agentId: Id<"agt">;
  readonly walletId: Id<"wal">;
}

/**
 * An order store under test, with the intent and agent stores of the same database, an agent at
 * version 0 with its wallet, and another agent with its own wallet.
 */
export interface OrderStoreSubject extends PlantedPair {
  readonly store: OrderStore;
  readonly intents: IntentStore;
  readonly agents: AgentStore;
  readonly other: PlantedPair;
}

/** A size past 64 bits, which every store keeps exact. */
const wideBase: bigint = 2n ** 64n + 1n;

/** A limit sale of the fixture token by the subject's agent and wallet. */
function limitSale(subject: PlantedPair): OrderRequest {
  return {
    kind: "limit",
    agent: subject.agentId,
    wallet: subject.walletId,
    token: testToken,
    side: "sell",
    size: { base: wideBase },
    worstPrice: wideBase,
    trigger: { price: 1_500_000n, direction: "above" },
    expiresAt: 90_000,
    maxFills: 1,
    reason: "take profit as asked",
  };
}

/** Order `n` of the subject's agent, awaiting the card of intent `n`, made at `100 * n`. */
export function orderDraft(subject: PlantedPair, n: number): OrderDraft {
  return {
    id: fixtureId("ord", n),
    agentId: subject.agentId,
    walletId: subject.walletId,
    request: limitSale(subject),
    maxFills: 1,
    expiresAtMs: 90_000,
    intentId: fixtureId("int", n),
    isPaper: true,
    hasOutsideContent: false,
    atMs: 100 * n,
  };
}

/** A move of order `n` from `version` into `state`, at `1000 + version`. */
export function orderMove(n: number, version: number, state: OrderMove["state"]): OrderMove {
  return { id: fixtureId("ord", n), expectedVersion: version, state, atMs: 1_000 + version };
}

/**
 * Stores intent `n` of the subject's agent with its first card version confirmed on Telegram, as
 * an order's `autoOrder` intent is once the owner taps Confirm.
 */
export async function confirmedCard(subject: OrderStoreSubject, n: number): Promise<Id<"crd">> {
  const { intents } = subject;
  assert.ok((await intents.create(intentDraft(subject, n), live())).ok);
  const opened = { ...intentMove(n, 0, "awaiting_confirmation"), openCard: cardOf(n, 1) };
  assert.ok((await intents.transition(opened, live())).ok);
  const confirmed = { ...intentMove(n, 1, "confirmed"), confirmation: confirmationOf(n, 1) };
  assert.ok((await intents.transition(confirmed, live())).ok);
  return cardOf(n, 1).id;
}

/** The agent's row version now, which a freeze names. */
export async function agentVersion(
  subject: OrderStoreSubject,
  agentId: Id<"agt">,
): Promise<number> {
  const agent = (await subject.agents.list(live())).find(({ id }) => id === agentId);
  assert.ok(agent !== undefined);
  return agent.version;
}
