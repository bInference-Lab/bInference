import type { Id } from "@binference/core";
import { testCoin, testWallet } from "../intents/test-intents.js";
import type { ExecutorBench } from "./test-executor.js";

const live = { signal: new AbortController().signal };

/** The test wallet holds one coin as a live position, each unit at one micro-dollar. */
export async function holdCoin(bench: ExecutorBench): Promise<void> {
  const base = 10n ** 18n;
  const position = {
    walletId: testWallet,
    asset: testCoin,
    isPaper: false,
    quantityBase: base,
    costUsdMicros: base,
    realizedUsdMicros: 0n,
    changedAtMs: 1,
  };
  const arrival = {
    walletId: testWallet,
    isPaper: false,
    atMs: 1,
    received: { asset: testCoin, base },
  };
  await bench.test.positions.recordArrival(
    { arrival: { ...arrival, valueUsdMicros: base }, positions: [{ position }] },
    live,
  );
}

/** What the coin's position holds after the intent, and what its transactions paid for gas. */
export async function coinAfter(
  bench: ExecutorBench,
  intent: Id<"int">,
): Promise<{ readonly held: bigint | undefined; readonly gas: bigint }> {
  const [held] = await bench.test.positions.positions(
    { walletId: testWallet, isPaper: false },
    live,
  );
  const stored = await bench.test.stores.transactions.ofIntent(intent, live);
  const gas = stored.reduce(
    (sum, { receipt }) => sum + (receipt?.gasUsed ?? 0n) * (receipt?.feePerGasBase ?? 0n),
    0n,
  );
  return { held: held?.quantityBase, gas };
}
