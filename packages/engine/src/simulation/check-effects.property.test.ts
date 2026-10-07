import type { AccountRef, AssetApproval, AssetRef, AssetTransfer } from "@binference/chain";
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { checkEffects, type EffectBounds } from "./check-effects.js";
import {
  allowed,
  coins,
  effectAccounts,
  effectAssets,
  moved,
  saleBounds,
  step,
  tokens,
} from "./test-effects.js";

const { wallet, router, pair, thief } = effectAccounts;
const stranger = fc.constantFrom<AccountRef>(router, pair, thief);
const base = fc.bigInt({ min: 1n, max: 10n ** 24n });

const sumOf = (transfers: readonly AssetTransfer[]): bigint =>
  transfers.reduce((total, transfer) => total + transfer.amount.base, 0n);

// The input leaves the wallet in pieces, the output arrives in pieces, and other accounts move
// any asset between themselves.
const spent: fc.Arbitrary<readonly AssetTransfer[]> = fc.array(
  fc
    .tuple(stranger, base)
    .map(([to, amount]: readonly [AccountRef, bigint]) => moved(wallet, to, tokens(amount))),
  { minLength: 1, maxLength: 4 },
);
const received: fc.Arbitrary<readonly AssetTransfer[]> = fc.array(
  base.map((amount) => moved(pair, wallet, coins(amount))),
  { minLength: 1, maxLength: 4 },
);
const between: fc.Arbitrary<readonly AssetTransfer[]> = fc.array(
  fc
    .tuple(stranger, stranger, fc.constantFrom<AssetRef>(...Object.values(effectAssets)), base)
    .map(([from, to, asset, amount]: readonly [AccountRef, AccountRef, AssetRef, bigint]) =>
      moved(from, to, { asset, base: amount }),
    ),
);

/** A sale's transfers in any order, the bounds they meet, and what the wallet received. */
interface Sale {
  readonly transfers: readonly AssetTransfer[];
  readonly bounds: EffectBounds;
  readonly received: bigint;
}

type Parts = readonly [
  readonly AssetTransfer[],
  readonly AssetTransfer[],
  readonly AssetTransfer[],
  bigint,
];

const sale: fc.Arbitrary<Sale> = fc
  .tuple(spent, received, between, fc.bigInt({ min: 0n, max: 10n ** 24n }))
  .chain(([outs, ins, others, slack]: Parts) => {
    const total = sumOf(ins);
    const bounds = {
      ...saleBounds,
      amountIn: tokens(sumOf(outs)),
      minOut: coins(total > slack ? total - slack : 0n),
    };
    const transfers = [...outs, ...ins, ...others];
    return fc
      .shuffledSubarray(transfers, { minLength: transfers.length })
      .map((shuffled: readonly AssetTransfer[]) => ({
        transfers: shuffled,
        bounds,
        received: total,
      }));
  });

// Another asset leaving the wallet, and more of the input leaving it.
const otherLeaving: fc.Arbitrary<AssetTransfer> = fc
  .tuple(stranger, fc.constantFrom(effectAssets.coin, effectAssets.other), base)
  .map(([to, asset, amount]: readonly [AccountRef, AssetRef, bigint]) =>
    moved(wallet, to, { asset, base: amount }),
  );
const inputLeaving: fc.Arbitrary<AssetTransfer> = fc
  .tuple(stranger, base)
  .map(([to, amount]: readonly [AccountRef, bigint]) => moved(wallet, to, tokens(amount)));
const unnamedAllowance: fc.Arbitrary<AssetApproval> = fc
  .tuple(fc.constantFrom(pair, thief), fc.bigInt({ min: 0n }))
  .map(([spender, amount]: readonly [AccountRef, bigint]) => allowed(spender, tokens(amount)));

// Splits transfers over two steps at any point, keeping their order.
function stepsOf(transfers: readonly AssetTransfer[], cut: number) {
  return [step(transfers.slice(0, cut)), step(transfers.slice(cut))];
}

describe("simulation check invariants", () => {
  it("passes every sale that spends exactly the input and receives at least the minimum", () => {
    fc.assert(
      fc.property(sale, fc.nat(12), (passing: Sale, cut: number) => {
        expect(checkEffects(stepsOf(passing.transfers, cut), passing.bounds)).toStrictEqual({
          ok: true,
          value: { spent: passing.bounds.amountIn, received: coins(passing.received) },
        });
      }),
    );
  });

  it("refuses every sale with a hidden transfer of another asset out of the wallet", () => {
    fc.assert(
      fc.property(sale, otherLeaving, fc.nat(12), (passing: Sale, hidden: AssetTransfer, cut) => {
        const steps = stepsOf([...passing.transfers, hidden], cut);
        expect(checkEffects(steps, passing.bounds)).toStrictEqual({
          ok: false,
          error: "other_outflow",
        });
      }),
    );
  });

  it("refuses every sale with a hidden transfer of more input out of the wallet", () => {
    fc.assert(
      fc.property(sale, inputLeaving, (passing: Sale, hidden: AssetTransfer) => {
        const steps = [step([hidden, ...passing.transfers])];
        expect(checkEffects(steps, passing.bounds)).toStrictEqual({
          ok: false,
          error: "other_amount",
        });
      }),
    );
  });

  it("refuses every allowance the wallet sets for a spender the plan never named", () => {
    fc.assert(
      fc.property(sale, unnamedAllowance, (passing: Sale, approval: AssetApproval) => {
        const steps = [step(passing.transfers), step([], [approval])];
        expect(checkEffects(steps, passing.bounds)).toStrictEqual({
          ok: false,
          error: "other_approval",
        });
      }),
    );
  });
});
