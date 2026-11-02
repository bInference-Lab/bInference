import {
  accountRefSchema,
  type AssetRef,
  assetRefParts,
  type ReceiptPool,
} from "@binference/plugin-sdk";
import { type Address, isAddress, isAddressEqual } from "viem";
import { creditTotalRead, validatorsRead } from "./hub-calls.js";
import { readEach, required } from "./hub-read.js";
import type { OptionsRead } from "./read-options.js";

interface Named {
  readonly receipt: AssetRef;
  readonly operator: Address;
  readonly credit: Address;
}

// Each receipt named that is a credit contract StakeHub lists on the read's chain, in the order
// named, once.
function namedCredits(
  at: OptionsRead,
  list: { readonly operators: readonly Address[]; readonly credits: readonly Address[] },
  receipts: readonly AssetRef[],
): readonly Named[] {
  const seen = new Set<string>();
  return receipts.flatMap((receipt) => {
    const { chain, assetNamespace, assetReference } = assetRefParts(receipt);
    const index = list.credits.findIndex(
      (credit) =>
        chain === at.chain &&
        assetNamespace === "erc20" &&
        isAddress(assetReference, { strict: false }) &&
        isAddressEqual(credit, assetReference),
    );
    const operator = list.operators[index];
    const credit = list.credits[index];
    if (operator === undefined || credit === undefined || seen.has(credit)) {
      return [];
    }
    seen.add(credit);
    return [{ receipt, operator, credit }];
  });
}

/**
 * The pools of the receipts named that are credit shares of a validator StakeHub lists, at the
 * read's block: every share of the credit contract and the coin it pools, which StakeCredit prices
 * each share by. A token StakeHub mints no credit for, and a credit contract that holds no share,
 * is left out. A revert of a call StakeHub always answers is `stakehub.read_failed`.
 */
export async function readPools(
  at: OptionsRead,
  receipts: readonly AssetRef[],
): Promise<readonly ReceiptPool[]> {
  if (receipts.length === 0) {
    return [];
  }
  const [list] = await readEach(at, [validatorsRead(at.hub)]);
  const named = namedCredits(at, required(list, "getValidators"), receipts);
  const totals = await readEach(
    at,
    named.flatMap(({ credit }) => [
      creditTotalRead(credit, "totalSupply"),
      creditTotalRead(credit, "totalPooledBNB"),
    ]),
  );
  return named.flatMap(({ receipt, operator }, index) => {
    const supply = required(totals[index * 2], "totalSupply");
    const pooled = required(totals[index * 2 + 1], "totalPooledBNB");
    if (supply === 0n) {
      return [];
    }
    const validator = accountRefSchema.parse(`${at.chain}:${operator}`);
    const pool = {
      shares: { asset: receipt, base: supply },
      coin: { asset: at.coin, base: pooled },
    };
    return [{ validator, pool }];
  });
}
