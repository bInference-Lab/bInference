import type {
  AccessStore,
  AgentStore,
  ConfigJournal,
  IdempotencyStore,
  InboxStore,
  InstallStore,
  IntentStore,
  LedgerStore,
  TransactionStore,
} from "../ports.js";

/**
 * Every store port of the engine database, as the composition root hands them to the engine, the
 * server and the Telegram channel. The intent store appends to the same ledger `ledger` reads.
 * Adapters: `createSqliteEngineStores` in `@binference/store`, and a Postgres adapter that passes
 * the same contract suites.
 */
export interface EngineStores {
  readonly intents: IntentStore;
  readonly ledger: LedgerStore;
  readonly idempotency: IdempotencyStore;
  readonly inbox: InboxStore;
  readonly access: AccessStore;
  readonly agents: AgentStore;
  readonly configJournal: ConfigJournal;
  readonly transactions: TransactionStore;
  readonly install: InstallStore;
}
