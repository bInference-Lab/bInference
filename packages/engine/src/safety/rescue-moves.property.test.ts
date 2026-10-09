import type { AccountRef, Amount, AssetRef } from "@binference/chain";
import type { Id } from "@binference/core";
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { RescueMove } from "../intents/rescue-quote.js";
import { type RescueWallet, rescueMoves } from "./rescue-moves.js";

const coin = "fake:1/slip44:1" as AssetRef;
const tokens = ["fake:1/token:0x0000000a", "fake:1/token:0x0000000b"] as AssetRef[];
const agent = "agt_0190f1c2-3a4b-7c5d-8e6f-000000000001" as Id<"agt">;

interface Drawn {
  readonly coinBase: bigint;
  readonly tokenBases: readonly bigint[];
  readonly gasReserveBase: bigint;
}

function walletOf(drawn: Drawn, index: number): RescueWallet {
  return {
    wallet: `wal_0190f1c2-3a4b-7c5d-8e6f-00000000000${String(index)}` as Id<"wal">,
    agentId: agent,
    account: `fake:1:0x0000000${String(index)}` as AccountRef,
    holdings: [
      { asset: coin, base: drawn.coinBase },
      ...tokens.map((asset, at) => ({ asset, base: drawn.tokenBases[at] ?? 0n })),
    ],
    gasReserveBase: drawn.gasReserveBase,
  };
}

const wallets: fc.Arbitrary<readonly RescueWallet[]> = fc
  .array(
    fc.record({
      coinBase: fc.bigInt({ min: 0n, max: 10n ** 20n }),
      tokenBases: fc.array(fc.bigInt({ min: 0n, max: 10n ** 30n }), {
        minLength: tokens.length,
        maxLength: tokens.length,
      }),
      gasReserveBase: fc.bigInt({ min: 0n, max: 10n ** 18n }),
    }),
    { maxLength: 4 },
  )
  .map((drawn: readonly Drawn[]) => drawn.map(walletOf));

// What a wallet should send of each asset it holds: a token whole, the coin above the reserve.
function expectedOf(wallet: RescueWallet): readonly bigint[] {
  return wallet.holdings.map((held: Amount) => {
    const kept = held.asset === coin ? wallet.gasReserveBase : 0n;
    return held.base > kept ? held.base - kept : 0n;
  });
}

// What the moves send of each asset the wallet holds, from the wallet's own account only.
function sentOf(moves: readonly RescueMove[], wallet: RescueWallet): readonly bigint[] {
  const own = moves.filter(
    ({ from, wallet: signer }) => from === wallet.account && signer === wallet.wallet,
  );
  return wallet.holdings.map(({ asset }) =>
    own
      .filter(({ amount }) => amount.asset === asset)
      .reduce((sum, { amount }) => sum + amount.base, 0n),
  );
}

// Each wallet's coin goes after its tokens, so the reserve pays for the token sends first.
function isCoinLast(moves: readonly RescueMove[], wallet: RescueWallet): boolean {
  const own = moves.filter(({ from }) => from === wallet.account);
  const coinAt = own.findIndex(({ amount }) => amount.asset === coin);
  return coinAt === -1 || coinAt === own.length - 1;
}

describe("the moves of a rescue", () => {
  it("send every token whole and the coin above the reserve, from its own wallet, coin last", () => {
    fc.assert(
      fc.property(wallets, (drawn) => {
        const moves = rescueMoves(drawn, coin);
        expect(drawn.map((wallet) => sentOf(moves, wallet))).toStrictEqual(drawn.map(expectedOf));
        expect(moves.every(({ amount }) => amount.base > 0n)).toBe(true);
        expect(drawn.every((wallet) => isCoinLast(moves, wallet))).toBe(true);
        expect(moves.every(({ from }) => drawn.some(({ account }) => account === from))).toBe(true);
      }),
    );
  });
});
