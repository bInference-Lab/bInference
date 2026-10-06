import type {
  AccessStore,
  AgentStore,
  ConfigJournal,
  IdempotencyStore,
  InboxStore,
  IntentStore,
  LedgerStore,
} from "../ports.js";

/**
 * Every store port of the engine database, as the composition root hands them to the engine, the
 * server and the Telegram channel. The intent store appends to the same ledger `ledger` reads.
 */
export interface EngineStores {
  readonly intents: IntentStore;
  readonly ledger: LedgerStore;
  readonly idempotency: IdempotencyStore;
  readonly inbox: InboxStore;
  readonly access: AccessStore;
  readonly agents: AgentStore;
  readonly configJournal: ConfigJournal;
}
