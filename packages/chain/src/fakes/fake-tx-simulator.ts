import { BinferenceError } from "@binference/core";
import type { Amount } from "../amount.js";
import type { AssetRef } from "../caip/asset-ref.js";
import type { TxSimulator } from "../simulation/ports.js";
import type { SimulatedStep } from "../simulation/simulated-step.js";

const reverted: SimulatedStep = { status: "reverted", gasUsed: 0n, transfers: [], approvals: [] };

function isHeld(need: Amount | undefined, balances: readonly Amount[]): boolean {
  return (
    need === undefined ||
    balances.some((held) => held.asset === need.asset && held.base >= need.base)
  );
}

function refuseUnsettable(balances: readonly Amount[], unsettable: ReadonlySet<AssetRef>): void {
  const unset = balances.find((amount) => unsettable.has(amount.asset));
  if (unset !== undefined) {
    throw new BinferenceError({
      code: "chain.balance_unset",
      message: "The fake simulator cannot set this token's balance.",
      details: { asset: unset.asset },
    });
  }
}

/**
 * Creates a simulator for tests that never touches a chain: each draft does what the table holds
 * for its payload, so a test sets every transfer and approval a step makes, hidden ones too. A
 * draft missing from the table reverts and moves nothing. The fake chain's wallets hold nothing,
 * so a draft whose payload `needs` an amount also reverts unless the run's `balances` hold at
 * least that much of its asset. A balance of an asset in `unsettable`, such as a token that
 * computes its balances, is a `chain.balance_unset` fault.
 */
export function createFakeTxSimulator(
  steps: ReadonlyMap<string, SimulatedStep>,
  needs: ReadonlyMap<string, Amount> = new Map(),
  unsettable: ReadonlySet<AssetRef> = new Set(),
): TxSimulator {
  return {
    async simulate(drafts, options): Promise<readonly SimulatedStep[]> {
      options.signal.throwIfAborted();
      const balances = options.balances ?? [];
      refuseUnsettable(balances, unsettable);
      return await Promise.resolve(
        drafts.map((draft) =>
          isHeld(needs.get(draft.payload), balances)
            ? (steps.get(draft.payload) ?? reverted)
            : reverted,
        ),
      );
    },
  };
}
