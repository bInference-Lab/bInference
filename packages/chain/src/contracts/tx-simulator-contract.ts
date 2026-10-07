import assert from "node:assert/strict";
import type { ContractCheck } from "@binference/core/testing";
import type { TxSimulator } from "../simulation/ports.js";
import type { AssetTransfer } from "../simulation/simulated-step.js";
import type { TxDraft } from "../transaction.js";

/** A simulator under test, drafts that run and move value, and drafts whose last one reverts. */
export interface TxSimulatorSubject {
  readonly simulator: TxSimulator;
  /** Drafts that all succeed, and one transfer their steps make. */
  readonly moving: { readonly drafts: readonly TxDraft[]; readonly transfer: AssetTransfer };
  /** Drafts whose last one reverts. */
  readonly reverting: readonly TxDraft[];
}

/** Makes a fresh {@link TxSimulatorSubject} for each check. */
export interface TxSimulatorHarness {
  create(): TxSimulatorSubject;
}

const live = (): { readonly signal: AbortSignal } => ({ signal: new AbortController().signal });

/** The contract every `TxSimulator` adapter passes. */
export function txSimulatorContract(harness: TxSimulatorHarness): readonly ContractCheck[] {
  return [
    {
      name: "reports one successful step per draft, with the transfers they make",
      run: async () => {
        const { simulator, moving } = harness.create();
        const steps = await simulator.simulate(moving.drafts, live());
        assert.equal(steps.length, moving.drafts.length);
        assert.ok(steps.every((step) => step.status === "success"));
        assert.ok(
          steps.some((step) => step.transfers.some((item) => isEqual(item, moving.transfer))),
        );
      },
    },
    {
      name: "reports a step that reverts as reverted, with nothing moved",
      run: async () => {
        const { simulator, reverting } = harness.create();
        const steps = await simulator.simulate(reverting, live());
        assert.equal(steps.length, reverting.length);
        const last = steps.at(-1);
        assert.equal(last?.status, "reverted");
        assert.deepEqual([last.transfers, last.approvals], [[], []]);
      },
    },
    {
      name: "rejects with the signal's reason once the signal aborts",
      run: async () => {
        const { simulator, moving } = harness.create();
        const reason = new Error("stopped");
        const aborted = { signal: AbortSignal.abort(reason) };
        await assert.rejects(simulator.simulate(moving.drafts, aborted), reason);
      },
    },
  ];
}

function isEqual(left: AssetTransfer, right: AssetTransfer): boolean {
  const { from, to, amount } = left;
  return (
    from === right.from &&
    to === right.to &&
    amount.asset === right.amount.asset &&
    amount.base === right.amount.base
  );
}
