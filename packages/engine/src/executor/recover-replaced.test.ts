import { createFakeSigningScheme, signFake } from "@binference/chain/testing";
import type { Id } from "@binference/core";
import { describe, expect, it } from "vitest";
import { fixtureId } from "../contracts/store-fixtures.js";
import { testAccount } from "../operations/test-engine.js";
import type { TransactionRecord } from "../wallet-queue/transaction-record.js";
import {
  benchChain,
  driveUntil,
  type ExecutorBench,
  flush,
  startExecutorBench,
  tapped,
  transactionsOf,
} from "./test-executor.js";
import { restartBench } from "./test-restart.js";

const live = () => ({ signal: new AbortController().signal });
const settled = { states: ["reconciled", "failed_onchain"] } as const;

// A swap whose first transaction is sent and waits below a fee the chain takes.
async function heldSwap() {
  const bench = await startExecutorBench();
  bench.network.holdBelow(52_000_000n);
  const intent = await tapped(bench);
  await flush();
  return { bench, intent };
}

// A replacement of the swap's first transaction, signed and stored as the stuck rules store one.
async function storedReplacement(
  bench: ExecutorBench,
  intent: Id<"int">,
  kind: "speedUp" | "cancel",
): Promise<TransactionRecord> {
  const [first] = await transactionsOf(bench);
  if (first === undefined) {
    throw new Error("Expected a stored transaction.");
  }
  const replaced = { chain: benchChain, raw: first.raw };
  const prepared = await bench.network.replace({ kind, from: testAccount, replaced }, live());
  if (!prepared.ok) {
    throw new Error("Expected a replacement.");
  }
  const { unsigned } = prepared.value;
  const signed = signFake(unsigned, "0x0000000c");
  const hash = createFakeSigningScheme().verify(unsigned, signed);
  if (!hash.ok) {
    throw new Error("Expected the fake scheme's hash.");
  }
  const replacement = {
    id: fixtureId("tx", 900),
    intentId: intent,
    step: first.step,
    account: first.account,
    nonce: first.nonce,
    raw: signed.raw,
    hash: hash.value,
    signedAtMs: bench.test.clock.now(),
    replaces: { id: first.id, kind },
  };
  const saved = await bench.test.stores.transactions.saveReplacement(replacement, live());
  if (!saved.ok) {
    throw new Error("Expected the store to keep the replacement.");
  }
  return saved.value;
}

// The states of the replacement and of the transaction whose nonce it took.
async function statesOf(bench: ExecutorBench, replacement: TransactionRecord) {
  const stored = await transactionsOf(bench);
  const first = stored.find(({ id }) => id === replacement.replaces?.id);
  const replacing = stored.find(({ id }) => id === replacement.id);
  return { first: first?.state, replacement: replacing?.state, landed: first?.hash };
}

describe("recovery of a step with a replacement", () => {
  it("reconciles the transaction the replacement took the nonce of when it landed", async () => {
    const { bench, intent } = await heldSwap();
    const speedUp = await storedReplacement(bench, intent, "speedUp");
    bench.network.holdBelow(0n);
    bench.network.mine();
    const restarted = await restartBench(bench);
    await expect(driveUntil(bench, intent, settled)).resolves.toBe("reconciled");
    const states = await statesOf(bench, speedUp);
    expect(states).toMatchObject({ first: "final", replacement: "superseded" });
    const executions = await bench.test.positions.executions(
      { isPaper: false, after: 0, limit: 10 },
      live(),
    );
    expect(executions.map(({ txHash }) => txHash)).toStrictEqual([states.landed]);
    expect(restarted.signed).toStrictEqual([]);
  });

  it("fails the intent stuck_cancelled when the step's cancel landed", async () => {
    const { bench, intent } = await heldSwap();
    const cancel = await storedReplacement(bench, intent, "cancel");
    await bench.network.send({ chain: benchChain, raw: cancel.raw }, live());
    bench.network.mine();
    const restarted = await restartBench(bench);
    await expect(driveUntil(bench, intent, settled)).resolves.toBe("failed_onchain");
    const record = await bench.test.stores.intents.get(intent, live());
    expect(record?.reason).toBe("stuck_cancelled");
    expect(await statesOf(bench, cancel)).toMatchObject({
      first: "superseded",
      replacement: "included",
    });
    expect(restarted.signed).toStrictEqual([]);
  });
});
