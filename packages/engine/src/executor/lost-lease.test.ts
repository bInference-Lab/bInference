import type { Signer } from "@binference/chain";
import { BinferenceError, type ErrorCode, type Id } from "@binference/core";
import { describe, expect, it } from "vitest";
import type { IntentState } from "../intents/intent-state.js";
import { testCoin, testSwap, testToken } from "../intents/test-intents.js";
import {
  driveUntil,
  eventsOf,
  type ExecutorBench,
  startExecutorBench,
  stateOf,
  tapped,
  transactionsOf,
} from "./test-executor.js";
import { benchLease, type LossPoint } from "./test-lost-lease.js";

// A sale of the token: an exact approval to the fake router, then the swap.
const tokenSale = testSwap({ from: testToken, to: testCoin, amount: { base: 1_000_000n } });

// What the executor logs only once it ends a step, an intent or a run as a fault.
const faultEvents: ReadonlySet<string> = new Set([
  "executor.failed",
  "executor.sign_failed",
  "executor.prepare_failed",
  "executor.step_stopped",
  "executor.step_unsent",
]);

function faultsOf(bench: ExecutorBench): readonly string[] {
  return bench.logger
    .records()
    .flatMap((record) => (faultEvents.has(record.event) ? [record.event] : []));
}

function noticesOf(bench: ExecutorBench): number {
  return bench.pushes.filter(({ kind }) => kind === "notice/new").length;
}

/** A place the lease is lost in a run, and where the intent must be left. */
interface LossCase {
  readonly name: string;
  readonly loss: LossPoint;
  readonly twoSteps?: boolean;
  readonly left: IntentState;
}

const lost = "store.lease_lost" as const;

const cases: readonly LossCase[] = [
  {
    name: "the signer service as it signs the first step",
    loss: { at: "custody.signTransaction", call: 1, code: lost },
    left: "executing",
  },
  {
    name: "a store host bound to another install as the first step signs",
    loss: { at: "custody.signTransaction", call: 1, code: "store.lease_mismatch" },
    left: "executing",
  },
  {
    name: "the signer service as it signs a later step",
    loss: { at: "custody.signTransaction", call: 2, code: lost },
    twoSteps: true,
    left: "executing",
  },
  {
    name: "the nonce write of the first step, before the queue took the intent",
    loss: { at: "transactions.nextNonce", call: 1, code: lost },
    left: "confirmed",
  },
  {
    name: "the nonce write of a later step",
    loss: { at: "transactions.nextNonce", call: 2, code: lost },
    twoSteps: true,
    left: "executing",
  },
  {
    name: "the move to executing once the queue took the intent",
    loss: { at: "intents.transition", call: 1, code: lost },
    left: "confirmed",
  },
  {
    name: "the store of a signed step",
    loss: { at: "transactions.saveSigned", call: 1, code: lost },
    left: "executing",
  },
  {
    name: "the record of a step's send",
    loss: { at: "transactions.recordSend", call: 1, code: lost },
    left: "executing",
  },
  {
    name: "a signed step's store whose commit the database could not tell about",
    loss: { at: "transactions.saveSigned", call: 1, code: "store.commit_unknown" },
    left: "executing",
  },
  {
    name: "a step's receipt record whose commit the database could not tell about",
    loss: { at: "transactions.recordReceipt", call: 1, code: "store.commit_unknown" },
    left: "executing",
  },
  {
    name: "the record of a step's receipt",
    loss: { at: "transactions.recordReceipt", call: 1, code: lost },
    left: "executing",
  },
  {
    name: "the trade's record in the positions",
    loss: { at: "positions.record", call: 1, code: lost },
    left: "finalized",
  },
];

async function runToLoss(item: LossCase) {
  const lease = benchLease(item.loss);
  const bench = await startExecutorBench(lease.options);
  const intent = await tapped(bench, item.twoSteps === true ? tokenSale : testSwap());
  await driveUntil(bench, intent, { states: [], blocks: 30 });
  return { bench, intent, lease };
}

describe("the executor once the install's lease is lost", () => {
  it.each(cases)("stops at $name and writes nothing after it", async (item) => {
    const { bench, intent, lease } = await runToLoss(item);
    expect(await stateOf(bench, intent)).toBe(item.left);
    expect(lease.after).toStrictEqual([]);
    expect(eventsOf(bench)).toContain(`executor.lease_lost:${item.loss.code}`);
    expect(faultsOf(bench)).toStrictEqual([]);
  });

  it("signs, stores and sends nothing more once the signer service says the lease is gone", async () => {
    const { bench, intent } = await runToLoss(cases[0] as LossCase);
    expect(bench.signed).toHaveLength(1);
    expect(await transactionsOf(bench)).toStrictEqual([]);
    expect(bench.network.sends()).toBe(0);
    expect(noticesOf(bench)).toBe(0);
    expect(await stateOf(bench, intent)).toBe("executing");
  });

  it("asks for no nonce again once its write is refused", async () => {
    const { bench, lease } = await runToLoss(cases[3] as LossCase);
    expect(lease.calls("transactions.nextNonce")).toBe(1);
    expect(bench.signed).toStrictEqual([]);
  });
});

// Custody that fails as it signs, with a fault whose code says nothing of the lease.
function failingCustody(code: ErrorCode): (custody: Signer) => Signer {
  return (custody: Signer): Signer => ({
    account: async (wallet, chain, options) => custody.account(wallet, chain, options),
    signTransaction: async () => {
      throw new BinferenceError({ code, message: "The signature failed." });
    },
  });
}

async function signedWith(code: ErrorCode): Promise<{ bench: ExecutorBench; intent: Id<"int"> }> {
  const bench = await startExecutorBench({ custody: failingCustody(code) });
  const intent = await tapped(bench);
  await driveUntil(bench, intent, { states: ["cancelled"], blocks: 3 });
  return { bench, intent };
}

describe("the executor on any other custody fault", () => {
  it("still cancels the intent as a step that could not be signed", async () => {
    const { bench, intent } = await signedWith("custody.sign_unknown");
    expect(await stateOf(bench, intent)).toBe("cancelled");
    expect(eventsOf(bench)).toContain("executor.sign_failed:custody.sign_unknown");
    expect(eventsOf(bench)).toContain("executor.step_unsent:cancelled");
  });

  it("still cancels it for a store fault that is no lost lease", async () => {
    const { bench, intent } = await signedWith("store.timeout");
    expect(await stateOf(bench, intent)).toBe("cancelled");
    expect(eventsOf(bench)).toContain("executor.sign_failed:store.timeout");
  });
});
