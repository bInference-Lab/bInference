import {
  type AccountRef,
  type Amount,
  isSameAccount,
  type RegisteredChain,
  type SimulatedStep,
  type TxDraft,
  type TxSimulator,
} from "@binference/chain";
import type { Clock } from "@binference/core";
import type { SimulationView } from "@binference/protocol";
import type { RescueMove } from "../intents/rescue-quote.js";

/** What a rescue's simulation runs on: the chain's simulator, the chain and the time. */
export interface RescueCheckParts {
  readonly simulator: TxSimulator;
  readonly chain: RegisteredChain;
  readonly clock: Clock;
}

/** The moves whose steps ran as planned, their drafts in the same order, and the view to store. */
export interface CheckedRescue {
  readonly moves: readonly RescueMove[];
  readonly drafts: readonly TxDraft[];
  readonly simulation: SimulationView;
}

interface Planned {
  readonly move: RescueMove;
  readonly draft: TxDraft;
}

/** A move whose step ran as planned, with what of it reached the rescue address. */
interface Passed extends Planned {
  readonly received: Amount;
}

function sumOf(amounts: readonly Amount[]): bigint {
  return amounts.reduce((sum, { base }) => sum + base, 0n);
}

// Each step's only outflow from its wallet is its move, whole; the rescue address gets some of
// it, a token's own transfer tax aside; and no allowance is set.
function ranAsPlanned(
  step: SimulatedStep | undefined,
  planned: Planned,
  context: { readonly rescue: AccountRef; readonly chain: RegisteredChain },
): Passed | undefined {
  const { move } = planned;
  const { asset } = move.amount;
  const { family } = context.chain;
  if (step?.status !== "success" || step.approvals.length > 0) {
    return undefined;
  }
  const out = step.transfers.filter(({ from }) => isSameAccount(from, move.from, family));
  const arrived = step.transfers.filter(
    ({ to, amount }) => isSameAccount(to, context.rescue, family) && amount.asset === asset,
  );
  const received = { asset, base: sumOf(arrived.map(({ amount }) => amount)) };
  const isWhole =
    out.every(({ amount }) => amount.asset === asset) &&
    sumOf(out.map(({ amount }) => amount)) === move.amount.base;
  return isWhole && received.base > 0n ? { ...planned, received } : undefined;
}

// The moves of one wallet run in their order on the chain's latest state, unsent.
async function checkWallet(
  parts: RescueCheckParts,
  group: readonly Planned[],
  call: { readonly rescue: AccountRef; readonly signal: AbortSignal },
): Promise<readonly Passed[]> {
  const steps = await parts.simulator.simulate(
    group.map(({ draft }) => draft),
    { signal: call.signal },
  );
  const context = { rescue: call.rescue, chain: parts.chain };
  return group.flatMap((planned, index) => ranAsPlanned(steps[index], planned, context) ?? []);
}

function totals(amounts: readonly Amount[]): readonly Amount[] {
  const byAsset = new Map<Amount["asset"], bigint>();
  for (const { asset, base } of amounts) {
    byAsset.set(asset, (byAsset.get(asset) ?? 0n) + base);
  }
  return [...byAsset].map(([asset, base]: readonly [Amount["asset"], bigint]) => ({ asset, base }));
}

function draftsOf(
  parts: RescueCheckParts,
  moves: readonly RescueMove[],
  rescue: AccountRef,
): readonly Planned[] {
  return moves.flatMap((move) => {
    const draft = parts.chain.family.transferDraft({
      from: move.from,
      to: rescue,
      amount: move.amount,
    });
    return draft.ok ? [{ move, draft: draft.value }] : [];
  });
}

/**
 * The simulate step of a rescue (spec 6, section 3): each move drafted as a send of its asset, as
 * it is, to the rescue address, and each wallet's sends run in order through the chain's
 * simulator. A move passes when its step succeeds, moves exactly its amount of its asset out of
 * its wallet and nothing else, sets no allowance, and lands some of the asset at the rescue
 * address: a token that takes a tax on transfers still goes. A move its family cannot draft, or
 * whose step fails these checks, is left out, so the rest still go; the card counts only what
 * passed. The view sums what leaves the wallets and what reaches the rescue address, by asset.
 */
export async function checkRescueMoves(
  parts: RescueCheckParts,
  call: {
    readonly moves: readonly RescueMove[];
    readonly rescue: AccountRef;
    readonly signal: AbortSignal;
  },
): Promise<CheckedRescue> {
  const planned = draftsOf(parts, call.moves, call.rescue);
  const accounts = [...new Set(planned.map(({ move }) => move.from))];
  const checked = await Promise.all(
    accounts.map(async (account) =>
      checkWallet(
        parts,
        planned.filter(({ move }) => move.from === account),
        call,
      ),
    ),
  );
  const kept = checked.flat();
  const moves = kept.map(({ move }) => move);
  return {
    moves,
    drafts: kept.map(({ draft }) => draft),
    simulation: {
      spent: totals(moves.map(({ amount }) => amount)),
      received: totals(kept.map(({ received }) => received)),
      simulatedAt: parts.clock.now(),
    },
  };
}
