import {
  type AccountRef,
  accountRefParts,
  type AssetTransfer,
  printAccountRef,
} from "@binference/chain";
import type { Bps } from "@binference/core";
import { type LegToken, lostBps } from "./leg-taxes.js";

/** A sale to read: how much the seller sold, and the token. */
export interface Sale {
  readonly sold: bigint;
  readonly token: LegToken;
}

type Key = (account: AccountRef) => string;

// An account in its family's canonical form, so two spellings of one account are one key.
function keyOf(token: LegToken): Key {
  return (account) => {
    const { chain, address } = accountRefParts(account);
    const parsed = token.family.parseAddress(address);
    const printed = parsed.ok ? printAccountRef({ chain, address: parsed.value }) : undefined;
    return printed?.ok === true ? printed.value : account;
  };
}

// Grows a set of accounts until no transfer adds one: `joins` names the account a transfer adds.
function closure(
  start: readonly string[],
  transfers: readonly AssetTransfer[],
  joins: (transfer: AssetTransfer, set: ReadonlySet<string>) => string | undefined,
): ReadonlySet<string> {
  const set = new Set(start);
  for (let size = -1; size !== set.size;) {
    size = set.size;
    for (const transfer of transfers) {
      const joined = joins(transfer, set);
      if (joined !== undefined) {
        set.add(joined);
      }
    }
  }
  return set;
}

/**
 * The sell tax of a sale's transfers, in basis points: the share of the `sold` amount that never
 * reached the pools that paid the seller. The pools are the accounts the sale's proceeds flow
 * through on their way to the seller. What reaches them counts only from the seller, or from an
 * account that passed the seller's tokens on and was paid nothing for them; what they send off
 * that path, such as a tax on a later hop, counts against it. A fee the token's own contract or a
 * tax contract sells into the same pool, paid out to anyone but the seller, is never the seller's.
 */
export function sellTaxBps(
  transfers: readonly AssetTransfer[],
  seller: AccountRef,
  sale: Sale,
): Bps {
  const { sold, token } = sale;
  const key = keyOf(token);
  const [sellerKey, contractKey] = [key(seller), key(token.contract)];
  const others = transfers.filter((transfer) => transfer.amount.asset !== token.asset);
  const tokens = transfers.filter((transfer) => transfer.amount.asset === token.asset);
  const proceeds = closure([sellerKey], others, ({ from, to }, set) =>
    set.has(key(to)) ? key(from) : undefined,
  );
  const isPool = (account: string): boolean =>
    proceeds.has(account) && account !== sellerKey && account !== contractKey;
  const paid = new Set(others.map((transfer) => key(transfer.to)));
  const passing = closure([sellerKey], tokens, ({ from, to }, set) => {
    const next = key(to);
    const isPassing = !isPool(next) && next !== contractKey && !paid.has(next);
    return set.has(key(from)) && isPassing ? next : undefined;
  });
  const taken = tokens.reduce((sum, { from, to, amount }) => {
    const [source, target] = [key(from), key(to)];
    const arrives = isPool(target) && !isPool(source) && passing.has(source) ? amount.base : 0n;
    const leaves = isPool(source) && !isPool(target) ? amount.base : 0n;
    return sum + arrives - leaves;
  }, 0n);
  return lostBps(sold, taken);
}
