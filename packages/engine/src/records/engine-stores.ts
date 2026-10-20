import type { AlertStore } from "../alerts/ports.js";
import type { ModelUsageStore } from "../billing/ports.js";
import type { AgentInboxStore, QuestionStore } from "../chat/ports.js";
import type { AliveStore } from "../downtime/ports.js";
import type { LaunchStore } from "../launches/ports.js";
import type { TrackedWalletStore } from "../leaders/ports.js";
import type { OrderStore } from "../orders/ports.js";
import type {
  AccessStore,
  AgentStore,
  ConfigJournal,
  IdempotencyStore,
  InboxStore,
  InstallStore,
  IntentStore,
  LedgerStore,
  NoticeStore,
  TransactionStore,
} from "../ports.js";
import type { ScheduleStore } from "../schedules/ports.js";
import type { DailySummaryStore } from "../summaries/ports.js";
import type { AgentTopicStore, CardCopyStore, OwnerStore } from "../surfaces/ports.js";

/**
 * Every store port of the engine database, as the composition root hands them to the engine, the
 * server and the Telegram channel. The intent store appends to the same ledger `ledger` reads.
 * Adapters: `createSqliteEngineStores` in `@binference/store`, and a Postgres adapter that passes
 * the same contract suites.
 */
export interface EngineStores {
  readonly intents: IntentStore;
  /** Auto orders; the intent store's freeze moves them in the same database. */
  readonly orders: OrderStore;
  readonly ledger: LedgerStore;
  readonly idempotency: IdempotencyStore;
  readonly inbox: InboxStore;
  readonly access: AccessStore;
  readonly agents: AgentStore;
  readonly configJournal: ConfigJournal;
  readonly transactions: TransactionStore;
  readonly install: InstallStore;
  readonly notices: NoticeStore;
  /** Who owns the install on Telegram, for the owner's bot. */
  readonly owners: OwnerStore;
  /** Where each card version was posted in Telegram. */
  readonly cardCopies: CardCopyStore;
  /** The topic of each agent in the owner's Telegram chat (decision 0186). */
  readonly agentTopics: AgentTopicStore;
  /** The agent inbox and each agent's open chat session. */
  readonly agentInbox: AgentInboxStore;
  /** The agent's questions to the owner and each surface's copy of them. */
  readonly questions: QuestionStore;
  /** Each model call attempt of the agents' runtime, and the budget notices of each day. */
  readonly modelUsage: ModelUsageStore;
  /** The owner's schedules and their runs, which store their wake-ups in the agent inbox. */
  readonly schedules: ScheduleStore;
  /** The agents' alerts and their fires, which store their wake-ups in the agent inbox. */
  readonly alerts: AlertStore;
  /** The tracked wallets, their trades and the leader watcher's cursors. */
  readonly trackedWallets: TrackedWalletStore;
  /** The launches the launch feed read and its cursors. */
  readonly launches: LaunchStore;
  /** When the engine last ran, which tells a start how long it was off. */
  readonly alive: AliveStore;
  /** Each agent's daily summary of each owner's date, with the totals it read. */
  readonly dailySummaries: DailySummaryStore;
}
