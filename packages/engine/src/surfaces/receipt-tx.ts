import type { ChainRef, ChainRegistry, TxHash } from "@binference/chain";
import type { DestinationChain } from "../address-book/destination-chain.js";
import type { ReceiptTx } from "../confirmations/card-closing.js";

// A transaction's page from an explorer's page template, or its hash with no template.
function linkedTx(txUrl: string | undefined, hash: TxHash): ReceiptTx {
  return txUrl === undefined ? { hash } : { explorerLink: txUrl.replace("{hash}", hash) };
}

/**
 * A transaction as a receipt links it: its page on the chain's first block explorer, from the
 * page template the registry lists for it, or its hash when the registry lists no explorer for
 * the chain.
 */
export function receiptTxOf(chains: ChainRegistry, chain: ChainRef, hash: TxHash): ReceiptTx {
  const registered = chains.get(chain);
  return linkedTx(
    registered.ok ? registered.value.definition.explorers[0]?.txUrl : undefined,
    hash,
  );
}

/**
 * A transaction on the chain a bridge delivered to, as a receipt links it: its page on the
 * explorer the destination's registry entry lists, else as {@link receiptTxOf} links it, so a
 * chain the engine only delivers to still gets its link.
 */
export function destinationTxOf(
  reads: {
    readonly chains: ChainRegistry;
    readonly destinations?: readonly DestinationChain[] | undefined;
  },
  chain: ChainRef,
  hash: TxHash,
): ReceiptTx {
  const txUrl = reads.destinations?.find(({ ref }) => ref === chain)?.txUrl;
  return txUrl === undefined ? receiptTxOf(reads.chains, chain, hash) : linkedTx(txUrl, hash);
}
