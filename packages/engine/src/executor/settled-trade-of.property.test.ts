import {
  type AccountRef,
  accountRefSchema,
  type AssetRef,
  type AssetTransfer,
} from "@binference/chain";
import { createFakeFamily } from "@binference/chain/testing";
import type { QuoteView } from "@binference/protocol";
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { testCoin, testToken } from "../intents/test-intents.js";
import type { TransactionRecord } from "../wallet-queue/transaction-record.js";
import { differsFromSimulation, settledTradeOf } from "./settled-trade-of.js";

const wallet = accountRefSchema.parse("fake:1:0x0000000c");
const router = accountRefSchema.parse("fake:1:0x0000000b");
const pair = accountRefSchema.parse("fake:1:0x0000000d");
const holder = { wallet, family: createFakeFamily() };
const quote = {
  amountIn: { asset: testCoin, base: 1n },
  expectedOut: { asset: testToken, base: 1n },
  gas: { asset: testCoin, base: 1n },
} as QuoteView;
const base = fc.bigInt({ min: 0n, max: 10n ** 24n });
const account = fc.constantFrom<AccountRef>(wallet, router, pair);
const transfer: fc.Arbitrary<AssetTransfer> = fc
  .tuple(account, account, fc.constantFrom(testCoin, testToken), base)
  .map(([from, to, asset, amount]: readonly [AccountRef, AccountRef, AssetRef, bigint]) => ({
    from,
    to,
    amount: { asset, base: amount },
  }));
const receipt = fc
  .tuple(base, base)
  .map(([gasUsed, feePerGasBase]: readonly [bigint, bigint]) => ({ gasUsed, feePerGasBase }));

interface Fee {
  readonly gasUsed: bigint;
  readonly feePerGasBase: bigint;
}

function stepOf(transfers: readonly AssetTransfer[], fee: Fee) {
  const transaction = {
    hash: "fake00000001",
    receipt: { hash: "fake00000001", block: { number: 1n, hash: "b" }, status: "success", ...fee },
  } as TransactionRecord;
  return { transaction, transfers };
}

const atLeastZero = (value: bigint): bigint => (value > 0n ? value : 0n);
const distance = (left: bigint, right: bigint): bigint =>
  left > right ? left - right : right - left;

// The wallet's net change of an asset, summed the plain way.
function netOf(transfers: readonly AssetTransfer[], asset: string): bigint {
  return transfers
    .filter(({ amount, from, to }) => amount.asset === asset && from !== to)
    .reduce((net, { amount, from, to }) => {
      const inbound = to === wallet ? amount.base : 0n;
      const outbound = from === wallet ? amount.base : 0n;
      return net + inbound - outbound;
    }, 0n);
}

describe("settledTradeOf, for any transfers and fees", () => {
  it("spends the input the wallet lost net, native coin received counted, never below 0", () => {
    fc.assert(
      fc.property(
        fc.array(transfer, { maxLength: 8 }),
        receipt,
        base,
        (transfers: readonly AssetTransfer[], fee: Fee, nativeReceivedBase: bigint) => {
          const terms = { quote, holder, nativeReceivedBase, atMs: 1 };
          const trade = settledTradeOf([stepOf(transfers, fee)], terms);
          const spent = -(netOf(transfers, testCoin) + nativeReceivedBase);
          const received = netOf(transfers, testToken);
          expect(trade.amountIn.base).toBe(atLeastZero(spent));
          expect(trade.amountOut.base).toBe(atLeastZero(received));
          expect(trade.gas.base).toBe(fee.gasUsed * fee.feePerGasBase);
        },
      ),
    );
  });
});

describe("differsFromSimulation, for any amounts", () => {
  it("flags exactly the trades more than 1% away from the simulation", () => {
    fc.assert(
      fc.property(base, fc.bigInt({ min: 1n, max: 10n ** 24n }), (actual, simulated) => {
        const trade = settledTradeOf([], { quote, holder, nativeReceivedBase: 0n, atMs: 1 });
        const out = { ...trade, amountOut: { asset: testToken, base: actual } };
        const simulation = {
          spent: [{ asset: testCoin, base: 0n }],
          received: [{ asset: testToken, base: simulated }],
          simulatedAt: 1,
        };
        const gap = distance(actual, simulated);
        expect(differsFromSimulation(out, simulation)).toBe(gap * 100n > simulated);
      }),
    );
  });
});
