import type { DecodedEvmTransaction } from "@binference/chain-evm";

/** The transaction object of Privy's `eth_signTransaction` body: a type 2 call, every field set. */
export interface PrivyTransaction {
  readonly type: 2;
  readonly chain_id: number;
  readonly nonce: number;
  readonly to: string;
  /** Wei, as a hex quantity. */
  readonly value: string;
  readonly data: string;
  readonly gas_limit: string;
  readonly max_fee_per_gas: string;
  readonly max_priority_fee_per_gas: string;
}

function quantity(value: bigint): string {
  return `0x${value.toString(16)}`;
}

/**
 * The transaction object of Privy's `eth_signTransaction` body for an unsigned type 2 call. Every
 * field is set, so Privy fills nothing in and signs exactly these bytes. Amounts travel as hex
 * quantities, the chain id as a number, as the ceiling's conditions compare them.
 */
export function privyTransaction(tx: DecodedEvmTransaction): PrivyTransaction {
  return {
    type: 2,
    chain_id: tx.chainId,
    nonce: tx.nonce,
    to: tx.to,
    value: quantity(tx.value),
    data: tx.data,
    gas_limit: quantity(tx.gas),
    max_fee_per_gas: quantity(tx.fees.maxFeePerGas),
    max_priority_fee_per_gas: quantity(tx.fees.maxPriorityFeePerGas),
  };
}
