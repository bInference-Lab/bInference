// The money stores' contract subjects on a fresh engine database's host, planted through its
// tasks, so one setup serves each store's SQLite and Postgres tests. Nothing in production uses
// this file.
import { accountRefSchema } from "@binference/chain";
import {
  type ConfirmationStoreSubject,
  heldConfirmations,
  type IdentityStoreSubject,
  type IntentStoreSubject,
  type LedgerStoreSubject,
  type OrderStoreSubject,
  type PositionStoreSubject,
  testAgentDraft,
  type TransactionStoreSubject,
  type UnbondingStoreSubject,
} from "@binference/engine/testing";
import { createSqliteAgentStore } from "../agents/sqlite-agent-store.js";
import { createSqliteInstallStore } from "../install/sqlite-install-store.js";
import { createSqliteIdentityStore } from "../intents/sqlite-identity-store.js";
import { createSqliteIntentStore } from "../intents/sqlite-intent-store.js";
import { createSqliteLedgerStore } from "../ledger/sqlite-ledger-store.js";
import { createSqliteOrderStore } from "../orders/sqlite-order-store.js";
import { createSqlitePositionStore } from "../positions/sqlite-position-store.js";
import type { StoreHost } from "../tasks/store-host.js";
import { createSqliteTransactionStore } from "../transactions/sqlite-transaction-store.js";
import { createSqliteUnbondingStore } from "../unbondings/sqlite-unbonding-store.js";
import { createIntent } from "./create-intent.js";
import { plantAgentOn, plantWalletOn } from "./plant-agent.js";
import { setTransactionState } from "./set-transaction-state.js";

/** The intent store's subject: the store, the stores it writes beside, and agent 1. */
export async function intentSubject(host: StoreHost): Promise<IntentStoreSubject> {
  return {
    store: createSqliteIntentStore(host),
    ledger: createSqliteLedgerStore(host),
    agents: createSqliteAgentStore(host),
    install: createSqliteInstallStore(host),
    ...(await plantAgentOn(host, 1)),
  };
}

/** The identity store's subject: the intent store's, with the identity store. */
export async function identitySubject(host: StoreHost): Promise<IdentityStoreSubject> {
  return { ...(await intentSubject(host)), identities: createSqliteIdentityStore(host) };
}

/** The ledger's subject, with agent 1. */
export async function ledgerSubject(host: StoreHost): Promise<LedgerStoreSubject> {
  return { ledger: createSqliteLedgerStore(host), agentId: (await plantAgentOn(host, 1)).agentId };
}

/** The order store's subject: agents 1 and 2, and the stores an order's fill writes beside. */
export async function orderSubject(host: StoreHost): Promise<OrderStoreSubject> {
  return {
    store: createSqliteOrderStore(host),
    intents: createSqliteIntentStore(host),
    agents: createSqliteAgentStore(host),
    ...(await plantAgentOn(host, 1)),
    other: await plantAgentOn(host, 2),
  };
}

/** The position store's subject: two wallets, and an intent of the first. */
export async function positionSubject(host: StoreHost): Promise<PositionStoreSubject> {
  const first = await plantAgentOn(host, 1);
  const second = await plantAgentOn(host, 2);
  return {
    store: createSqlitePositionStore(host),
    walletIds: [first.walletId, second.walletId],
    intentId: await createIntent(host, first, 1),
  };
}

/** The transaction store's subject: two intents of agent 1, two accounts, and a state setter. */
export async function transactionSubject(host: StoreHost): Promise<TransactionStoreSubject> {
  const agent = await plantAgentOn(host, 1);
  return {
    store: createSqliteTransactionStore(host),
    intentIds: [await createIntent(host, agent, 1), await createIntent(host, agent, 2)],
    accounts: [
      accountRefSchema.parse("fake:1:0x0000000a"),
      accountRefSchema.parse("fake:1:0x0000000b"),
    ],
    setState: async (id, state) => setTransactionState(host, id, state),
  };
}

/** The unbonding store's subject: three intents of agent 1 and its wallet. */
export async function unbondingSubject(host: StoreHost): Promise<UnbondingStoreSubject> {
  const agent = await plantAgentOn(host, 1);
  const intentIds = [
    await createIntent(host, agent, 1),
    await createIntent(host, agent, 2),
    await createIntent(host, agent, 3),
  ] as const;
  return { store: createSqliteUnbondingStore(host), intentIds, walletId: agent.walletId };
}

/**
 * The confirmation store's subject: the engine's stored intents over the intent and agent stores,
 * holding one intent of the test agent, whose wallet is planted once the agent store made it.
 */
export function confirmationSubject(host: StoreHost): ConfirmationStoreSubject {
  const agents = createSqliteAgentStore(host);
  const placeAgent = async (): Promise<void> => {
    const created = await agents.create(testAgentDraft(), { signal: AbortSignal.timeout(30_000) });
    if (!created.ok) {
      throw new Error(`The test agent was not created: ${created.error}.`);
    }
    await plantWalletOn(host, 1);
  };
  return heldConfirmations({ intents: createSqliteIntentStore(host), agents, placeAgent });
}
