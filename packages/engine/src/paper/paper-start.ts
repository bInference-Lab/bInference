import { BinferenceError, type Id } from "@binference/core";
import type { AgentStore, InstallStore, PositionStore, WalletFactsSource } from "../ports.js";
import type { PaperPortfolio } from "./paper-portfolio.js";

/** What the paper start reads and writes through. */
export interface PaperStartOptions {
  readonly agents: AgentStore;
  readonly install: InstallStore;
  /** Where each wallet's paper records live: its positions, arrivals and executions. */
  readonly positions: PositionStore;
  readonly portfolio: PaperPortfolio;
  /** The wallets the paper portfolio opens in, read beside the install's own records. */
  readonly wallets: WalletFactsSource;
}

interface Call {
  readonly signal: AbortSignal;
}

// Agents found started or with paper records, so a later pass reads nothing for them. The stores
// decide alone: past the bound the set empties, and the next pass reads each agent again.
const settledMax = 10_000;

// Whether a wallet holds any paper record: a position, an empty one too, an arrival or a fill.
async function hasPaperRecords(store: PositionStore, walletId: Id<"wal">, call: Call) {
  const page = { after: 0, limit: 1, isPaper: true, walletId };
  const [positions, arrivals, executions] = await Promise.all([
    store.positions({ walletId, isPaper: true }, call),
    store.arrivals(page, call),
    store.executions(page, call),
  ]);
  return positions.length + arrivals.length + executions.length > 0;
}

/** What one pass of the paper start did: the agents it started, and the ones that still wait. */
export interface PaperStartPass {
  readonly started: readonly Id<"agt">[];
  /** Agents with no paper portfolio yet: no wallet, or no price for a starting balance. */
  readonly waiting: readonly Id<"agt">[];
}

/** How one agent's pass ended: it had paper records, it started now, it waits, or it failed. */
type AgentPass =
  | { readonly id: Id<"agt">; readonly kind: "had" | "started" | "waits" }
  | { readonly id: Id<"agt">; readonly kind: "failed"; readonly error: BinferenceError };

// A lost race means another paper write reached the agent's wallet first, so it had a paper
// portfolio by then.
async function startOne(
  options: PaperStartOptions,
  agent: { readonly id: Id<"agt">; readonly wallets: readonly Id<"wal">[] },
  call: Call,
): Promise<AgentPass> {
  const { id } = agent;
  try {
    const held = await Promise.all(
      agent.wallets.map(async (walletId) => hasPaperRecords(options.positions, walletId, call)),
    );
    if (held.includes(true)) {
      return { id, kind: "had" };
    }
    const started = await options.portfolio.start({ agent: id }, call);
    if (started.ok) {
      return { id, kind: "started" };
    }
    return { id, kind: started.error === "stale" ? "had" : "waits" };
  } catch (error) {
    call.signal.throwIfAborted();
    const failed =
      error instanceof BinferenceError
        ? error
        : new BinferenceError({
            code: "paper.start_failed",
            message: "An agent's paper portfolio could not be started.",
            cause: error,
          });
    return { id, kind: "failed", error: failed };
  }
}

/**
 * Creates the paper start (decision 0450), which a timer of the composition root runs once the
 * engine serves and every minute after: each agent not archived, live ones too, whose wallets,
 * archived ones included, hold no paper position, arrival or fill gets the starting balances
 * through the paper portfolio's `start`, the code a paper reset runs. An agent with no wallet or
 * no price for a starting balance waits for the next pass. Answers the agents it started and the
 * ones that wait. Every agent is tried even when another fails; the first failure is thrown once
 * all are tried.
 */
export function createPaperStart(
  options: PaperStartOptions,
): (call: Call) => Promise<PaperStartPass> {
  const settled = new Set<Id<"agt">>();
  const settle = (id: Id<"agt">): void => {
    if (settled.size >= settledMax) {
      settled.clear();
    }
    settled.add(id);
  };
  return async (call) => {
    const [records, install] = await Promise.all([
      options.agents.list(call),
      options.install.read(call),
    ]);
    const unsettled = records.filter(
      ({ id, archivedAtMs }) => archivedAtMs === undefined && !settled.has(id),
    );
    const passes = await Promise.all(
      unsettled.map(async ({ id }) => {
        const stored = install.wallets.filter((wallet) => wallet.agentId === id);
        const used = await options.wallets.wallets(id, call);
        const wallets = new Set([...stored.map((wallet) => wallet.id), ...used]);
        return startOne(options, { id, wallets: [...wallets] }, call);
      }),
    );
    const started: Id<"agt">[] = [];
    const waiting: Id<"agt">[] = [];
    const failures: BinferenceError[] = [];
    for (const pass of passes) {
      if (pass.kind === "failed") {
        failures.push(pass.error);
      } else if (pass.kind === "waits") {
        waiting.push(pass.id);
      } else {
        settle(pass.id);
        if (pass.kind === "started") {
          started.push(pass.id);
        }
      }
    }
    const [failure] = failures;
    if (failure !== undefined) {
      throw failure;
    }
    return { started, waiting };
  };
}
