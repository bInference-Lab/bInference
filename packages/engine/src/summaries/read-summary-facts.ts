import type { Id } from "@binference/core";
import type { AgentSettings } from "../agents/agent-record.js";
import { limitsValuesOf } from "../agents/limits-record.js";
import type { ModelUsageStore } from "../billing/ports.js";
import type { QuestionStore } from "../chat/ports.js";
import type { HeldWallet } from "../executor/held-wallets.js";
import type { WalletRecord } from "../install/install-record.js";
import type { OrderStore } from "../orders/ports.js";
import { readAllRows } from "../pnl/read-all-rows.js";
import { limitsChanged } from "../policy/limit-change.js";
import type { InstallStore, IntentStore } from "../ports.js";
import type { ModeFigures, SummaryFacts } from "./summary-facts.js";
import { type HoldingsParts, totalsOf } from "./summary-totals.js";

/** What the summary facts are read from. */
export interface SummaryFactsParts extends HoldingsParts {
  readonly install: Pick<InstallStore, "read">;
  readonly intents: Pick<IntentStore, "list">;
  readonly orders: Pick<OrderStore, "fillCounts" | "list">;
  readonly questions: Pick<QuestionStore, "openOf">;
  readonly usage: Pick<ModelUsageStore, "spent">;
  /** The wallets the executor's stuck steps hold now; none where no executor runs. */
  readonly heldWallets: () => readonly HeldWallet[];
}

/** The agent and the 24 hours a summary reads. */
export interface SummaryWindow {
  readonly settings: AgentSettings;
  readonly fromMs: number;
  readonly nowMs: number;
}

interface Read {
  readonly signal: AbortSignal;
}

// The most rows of one kind a summary counts; past it, the count says this many.
const countLimit = 1_000;

// What the trades of a mode's wallets realized in the window, and how many there were.
async function tradesOf(
  parts: SummaryFactsParts,
  query: { readonly wallets: readonly Id<"wal">[]; readonly isPaper: boolean },
  window: SummaryWindow & Read,
): Promise<Omit<ModeFigures, "totalUsdMicros">> {
  const { fromMs, nowMs, signal } = window;
  const pages = await Promise.all(
    query.wallets.map(async (walletId) =>
      readAllRows(async (after, limit) =>
        parts.store.executions(
          { walletId, isPaper: query.isPaper, fromMs, toMs: nowMs, after, limit },
          { signal },
        ),
      ),
    ),
  );
  const executions = pages.flat();
  const realizedUsdMicros = executions.reduce((sum, row) => sum + row.realizedUsdMicros, 0n);
  return { realizedUsdMicros, trades: executions.length };
}

// What waits for the owner: the agent's open cards, its question while it can be answered, the
// looser limits that wait, and the wallets stuck steps hold.
async function waitsOf(parts: SummaryFactsParts, window: SummaryWindow & Read) {
  const { settings, nowMs, signal } = window;
  const agentId = settings.agent.id;
  const states = ["awaiting_confirmation"] as const;
  const [cards, question] = await Promise.all([
    parts.intents.list({ states, agentId, limit: countLimit }, { signal }),
    parts.questions.openOf(agentId, { signal }),
  ]);
  const { pending } = settings.limits;
  return {
    cards: cards.length,
    question: question?.state === "open" && question.closesAtMs > nowMs,
    limits:
      pending === undefined
        ? 0
        : limitsChanged(limitsValuesOf(settings.limits), pending.values).length,
    heldWallets: parts.heldWallets().filter(({ agent }) => agent === agentId).length,
  };
}

// The agent's wallets: every one for its trades, which happened whatever came after, and those
// not archived for what it holds now.
async function walletsOf(
  parts: SummaryFactsParts,
  agentId: Id<"agt">,
  call: Read,
): Promise<readonly WalletRecord[]> {
  const { wallets } = await parts.install.read(call);
  return wallets.filter((wallet) => wallet.agentId === agentId);
}

/**
 * What the agent's daily summary tells (spec 4, section 4): live and paper apart, each with its
 * holdings' total now and the trades of the window, never added together (decision 0134); the
 * fills and skips of its auto orders in the window; its open orders; its model spend in the
 * window against its daily model budget; and what waits for the owner now. A live balance that
 * cannot be read leaves the live total out, never the rest.
 */
export async function summaryFactsOf(
  parts: SummaryFactsParts,
  window: SummaryWindow & Read,
): Promise<SummaryFacts> {
  const { settings, fromMs, nowMs, signal } = window;
  const agentId = settings.agent.id;
  const wallets = await walletsOf(parts, agentId, { signal });
  const ids = wallets.map(({ id }) => id);
  const open = ["active", "paused"] as const;
  const toMs = nowMs + 1;
  const [totals, live, paper, fills, orders, spent, waits] = await Promise.all([
    totalsOf(parts, wallets, { signal }),
    tradesOf(parts, { wallets: ids, isPaper: false }, window),
    tradesOf(parts, { wallets: ids, isPaper: true }, window),
    parts.orders.fillCounts({ agentId, fromMs, toMs }, { signal }),
    parts.orders.list({ states: open, agentId, limit: countLimit }, { signal }),
    parts.usage.spent({ agent: agentId, fromMs, toMs }, { signal }),
    waitsOf(parts, window),
  ]);
  return {
    live: { ...live, ...(totals.live === undefined ? {} : { totalUsdMicros: totals.live }) },
    paper: { ...paper, totalUsdMicros: totals.paper },
    fills,
    openOrders: orders.length,
    spendUsdMicros: spent.reduce((sum, { usdMicros }) => sum + usdMicros, 0n),
    budgetUsdMicros: settings.limits.modelBudgetUsdMicros,
    waits,
  };
}
