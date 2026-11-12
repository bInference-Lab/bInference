import { chainRefParts, type SignedTx, type SignRequest, type TxHash } from "@binference/chain";
import {
  createEvmSigningScheme,
  type DecodedEvmTransaction,
  decodeEvmTransaction,
} from "@binference/chain-evm";
import { BinferenceError } from "@binference/core";

/**
 * The request's transaction read back from its payload, which must be an unsigned EVM type 2
 * call; any other payload throws `custody.transaction_unreadable`.
 */
export function readableTransaction(request: SignRequest): DecodedEvmTransaction {
  const decoded = decodeEvmTransaction(request.tx);
  if (!decoded.ok) {
    throw new BinferenceError({
      code: "custody.transaction_unreadable",
      message: "The transaction to sign is not an unsigned EVM type 2 call.",
      details: { intent: request.intent },
    });
  }
  return decoded.value;
}

/** Whether the transaction's EIP-155 chain id is the chain the request names. */
export function isOnItsChain(request: SignRequest, decoded: DecodedEvmTransaction): boolean {
  return chainRefParts(request.tx.chain).reference === String(decoded.chainId);
}

/**
 * The custodian's signed bytes as a signed transaction of the request's chain, with its hash, once
 * they are exactly the transaction asked and signed by the wallet. Anything else throws
 * `custody.signed_other_transaction`, so no other bytes ever leave as signed.
 */
export function checkedSigned(
  request: SignRequest,
  raw: string,
): { readonly signed: SignedTx; readonly hash: TxHash } {
  const signed: SignedTx = { chain: request.tx.chain, raw };
  const verified = createEvmSigningScheme().verify(request.tx, signed);
  if (!verified.ok) {
    throw new BinferenceError({
      code: "custody.signed_other_transaction",
      message:
        "The custodian answered a transaction other than the one asked, or one signed by another key.",
      details: { intent: request.intent },
    });
  }
  return { signed, hash: verified.value };
}
