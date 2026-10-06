import { type UnsignedTx, accountRefParts } from "@binference/chain";
import { err, ok, type Result } from "@binference/core";
import {
  type Address,
  getAddress,
  type Hex,
  parseTransaction,
  serializeTransaction,
  type TransactionSerializableEIP1559,
} from "viem";
import { parseEvmAddress } from "../evm-address.js";
import { type EvmChain, evmAccountRef } from "../evm-chain.js";
import type { EvmFees } from "../fees/read-fees.js";

/** An EVM transaction before signing: an EIP-1559 call from one account. */
export interface EvmTransaction {
  readonly from: Address;
  readonly to: Address;
  /** Native value in wei. */
  readonly value: bigint;
  readonly data: Hex;
  /** The sender's nonce, which the wallet queue owns. */
  readonly nonce: number;
  /** The gas limit. */
  readonly gas: bigint;
  readonly fees: EvmFees;
}

/** An unsigned EVM transaction read back from its payload. */
export interface DecodedEvmTransaction extends EvmTransaction {
  /** The EIP-155 chain id the payload commits to. */
  readonly chainId: number;
}

/**
 * Encodes a transaction as an `UnsignedTx` whose payload is the EIP-2718 type-2 serialization:
 * the bytes whose hash the sender signs.
 */
export function encodeEvmTransaction(chain: EvmChain, tx: EvmTransaction): UnsignedTx {
  const payload = serializeTransaction({
    type: "eip1559",
    chainId: chain.chainId,
    nonce: tx.nonce,
    gas: tx.gas,
    maxFeePerGas: tx.fees.maxFeePerGas,
    maxPriorityFeePerGas: tx.fees.maxPriorityFeePerGas,
    to: tx.to,
    value: tx.value,
    data: tx.data,
  });
  return { chain: chain.ref, from: evmAccountRef(chain, tx.from), payload };
}

/** Whether a text is hex bytes: `0x` and at least one whole byte. */
export function isHexPayload(text: string): text is Hex {
  return /^0x(?:[0-9a-fA-F]{2})+$/.test(text);
}

/** Parses serialized transaction bytes; bytes viem cannot read are undefined. */
export function parseSerialized(raw: string): ReturnType<typeof parseTransaction> | undefined {
  if (!isHexPayload(raw)) {
    return undefined;
  }
  try {
    return parseTransaction(raw);
  } catch {
    return undefined;
  }
}

// The encoding leaves a zero field empty, and viem reads an empty field as undefined. viem reads
// `to` in lowercase; the caller passes it checksummed.
function withZeros(
  parsed: TransactionSerializableEIP1559,
  from: Address,
  to: Address,
): DecodedEvmTransaction {
  const { value = 0n, data = "0x", nonce = 0, gas = 0n } = parsed;
  const { maxFeePerGas = 0n, maxPriorityFeePerGas = 0n } = parsed;
  return {
    chainId: parsed.chainId,
    from,
    to,
    value,
    data,
    nonce,
    gas,
    fees: { maxFeePerGas, maxPriorityFeePerGas },
  };
}

/**
 * Reads an `UnsignedTx` back into its fields. A payload that is not an unsigned type-2 call, or a
 * sender that is not an EVM address, is an expected failure. A field the encoding leaves empty,
 * such as a zero value, reads as zero.
 */
export function decodeEvmTransaction(
  unsigned: UnsignedTx,
): Result<DecodedEvmTransaction, "malformed_transaction"> {
  const parsed = parseSerialized(unsigned.payload);
  const from = parseEvmAddress(accountRefParts(unsigned.from).address);
  if (parsed?.type !== "eip1559" || parsed.r !== undefined || !parsed.to || !from.ok) {
    return err("malformed_transaction");
  }
  return ok(withZeros(parsed, from.value, getAddress(parsed.to)));
}
