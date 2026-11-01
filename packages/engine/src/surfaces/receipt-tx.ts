import type { ChainRef, ChainRegistry, TxHash } from "@binference/chain";
import type { ReceiptTx } from "../confirmations/card-closing.js";

/**
 * A transaction as a receipt links it: its page on the chain's first block explorer, from the
 * page template the registry lists for it, or its hash when the registry lists no explorer for
 * the chain.
 */
export function receiptTxOf(chains: ChainRegistry, chain: ChainRef, hash: TxHash): ReceiptTx {
  const registered = chains.get(chain);
  const explorer = registered.ok ? registered.value.definition.explorers[0] : undefined;
  return explorer === undefined
    ? { hash }
    : { explorerLink: explorer.txUrl.replace("{hash}", hash) };
}
