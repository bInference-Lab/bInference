import {
  type AccountRef,
  type AssetRef,
  type AssetTransfer,
  type ChainFamily,
  isSameAccount,
} from "@binference/chain";
import { type Bps, bpsPerWhole, bpsSchema, mulDiv } from "@binference/core";
import { z } from "zod";

/** An asset, and the family that compares the accounts holding it. */
export interface Holding {
  readonly asset: AssetRef;
  readonly family: ChainFamily;
}

/** The token a leg moves, and its own contract, which the decoding tells apart from a pool. */
export interface LegToken extends Holding {
  /** The token's own contract, which takes and swaps its fees; its moves are never a pool's. */
  readonly contract: AccountRef;
}

const wholeBps = BigInt(bpsPerWhole);
const bpsFromBase = z.bigint().pipe(z.coerce.number()).pipe(bpsSchema);

function isToken(transfer: AssetTransfer, holding: Holding): boolean {
  return transfer.amount.asset === holding.asset;
}

function isAccount(left: AccountRef, right: AccountRef, holding: Holding): boolean {
  return isSameAccount(left, right, holding.family);
}

/** What of the asset reached `account` in these transfers, minus what left it. */
export function netIn(
  transfers: readonly AssetTransfer[],
  account: AccountRef,
  holding: Holding,
): bigint {
  return transfers
    .filter((transfer) => isToken(transfer, holding))
    .reduce((net, { from, to, amount }) => {
      const arrives = isAccount(to, account, holding) ? amount.base : 0n;
      const leaves = isAccount(from, account, holding) ? amount.base : 0n;
      return net + arrives - leaves;
    }, 0n);
}

/**
 * The share of `sent` that did not arrive, in basis points rounded up, so a tax is never read
 * lower than it is: 0 when everything arrived, 10,000 when nothing did.
 */
export function lostBps(sent: bigint, arrived: bigint): Bps {
  if (sent <= 0n || arrived >= sent) {
    return bpsFromBase.parse(0n);
  }
  const kept = arrived > 0n ? arrived : 0n;
  return bpsFromBase.parse(mulDiv(sent - kept, { numerator: wholeBps, denominator: sent }, "up"));
}

// The accounts other than the trader and the token's contract that moved some other asset in the
// leg: in a swap, its pools and the contracts that route through them. A fee wallet moves only the
// token, so it is never among them.
function swapAccounts(
  transfers: readonly AssetTransfer[],
  leg: { readonly trader: AccountRef; readonly token: LegToken; readonly side: "from" | "to" },
): readonly AccountRef[] {
  const { trader, token, side } = leg;
  const accounts = transfers
    .filter((transfer) => !isToken(transfer, token))
    .map((transfer) => transfer[side])
    .filter((account) => !isAccount(account, trader, token))
    .filter((account) => !isAccount(account, token.contract, token));
  return accounts.filter(
    (account, index) => accounts.findIndex((other) => isAccount(other, account, token)) === index,
  );
}

/** A buy leg's shares of what the swap's pools paid out: the token's tax, and the hooks' fee. */
export interface BuyLeg {
  readonly taxBps: Bps;
  /** The share the route's pool hooks took as transfers of the token, as their pools' own fee. */
  readonly hookFeeBps: Bps;
}

/**
 * A buy leg's taxes from a swap's transfers, in basis points: of the token the swap's pools paid
 * out net (the accounts that took another asset in), the share a hook of the route took, which is
 * its pool's fee (decision 0215), and of the rest, the share that never reached the buyer, which
 * is the token's tax. A tax taken at each hop of a route counts in full.
 */
export function buyLegOf(
  transfers: readonly AssetTransfer[],
  buyer: AccountRef,
  token: LegToken & { readonly hooks: readonly AccountRef[] },
): BuyLeg {
  const pools = swapAccounts(transfers, { trader: buyer, token, side: "to" });
  const paidOut = pools.reduce((sum, pool) => {
    const net = -netIn(transfers, pool, token);
    return net > 0n ? sum + net : sum;
  }, 0n);
  const taken = token.hooks.reduce((sum, hook) => {
    const net = netIn(transfers, hook, token);
    return net > 0n ? sum + net : sum;
  }, 0n);
  const kept = taken < paidOut ? paidOut - taken : 0n;
  return {
    taxBps: lostBps(kept, netIn(transfers, buyer, token)),
    hookFeeBps: lostBps(paidOut, kept),
  };
}

/** The buy tax of a swap's transfers through no pool hook: {@link buyLegOf}'s token tax. */
export function buyTaxBps(
  transfers: readonly AssetTransfer[],
  buyer: AccountRef,
  token: LegToken,
): Bps {
  return buyLegOf(transfers, buyer, { ...token, hooks: [] }).taxBps;
}
