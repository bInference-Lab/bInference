import type { JsonValue } from "@binference/core";
import { z } from "zod";

/**
 * An EVM transaction as the signer reads it out of Privy's `eth_signTransaction` body. Addresses
 * and calldata are lowercase hex; a missing value is 0 and missing calldata is `0x`.
 */
export interface EvmTransaction {
  readonly chainId?: bigint;
  /** The account called; none for a contract creation. */
  readonly to?: string;
  readonly value: bigint;
  readonly data: string;
  readonly nonce: bigint;
  /** The most fee per gas it pays: `max_fee_per_gas`, or `gas_price` for older types. */
  readonly feePerGas?: bigint;
  readonly type?: number;
  /** Whether it carries an EIP-7702 authorization list. */
  readonly delegates: boolean;
}

/** What a Privy request body holds, as the hard rules read it. */
export type PrivyCall =
  | { readonly kind: "transaction"; readonly transaction: EvmTransaction }
  | { readonly kind: "otherMethod" }
  | { readonly kind: "unreadable" };

// Privy takes a quantity as a number or as text; the signer takes safe integers and 0x hex only,
// since decimal text and hex text could read alike.
const quantitySchema = z
  .union([z.int().nonnegative(), z.string().regex(/^0x[0-9a-fA-F]{1,64}$/)])
  .transform((quantity) => BigInt(quantity));

// A transaction that names both fees pays at most the larger one.
function feeOf(
  maxFeePerGas: bigint | undefined,
  gasPrice: bigint | undefined,
): { readonly feePerGas?: bigint } {
  const fees = [maxFeePerGas, gasPrice].filter((fee) => fee !== undefined);
  return fees.length === 0
    ? {}
    : { feePerGas: fees.reduce((most, fee) => (fee > most ? fee : most)) };
}

const transactionSchema = z
  .strictObject({
    to: z
      .string()
      .regex(/^0x[0-9a-fA-F]{40}$/)
      .exactOptional(),
    value: quantitySchema.exactOptional(),
    chain_id: quantitySchema.exactOptional(),
    data: z
      .string()
      .regex(/^0x(?:[0-9a-fA-F]{2})*$/)
      .exactOptional(),
    nonce: quantitySchema,
    type: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(4)]).exactOptional(),
    gas_limit: quantitySchema.exactOptional(),
    gas_price: quantitySchema.exactOptional(),
    max_fee_per_gas: quantitySchema.exactOptional(),
    max_priority_fee_per_gas: quantitySchema.exactOptional(),
    authorization_list: z.array(z.json()).exactOptional(),
  })
  .transform((fields): EvmTransaction => ({
    ...(fields.chain_id === undefined ? {} : { chainId: fields.chain_id }),
    ...(fields.to === undefined ? {} : { to: fields.to.toLowerCase() }),
    value: fields.value ?? 0n,
    data: (fields.data ?? "0x").toLowerCase(),
    nonce: fields.nonce,
    ...feeOf(fields.max_fee_per_gas, fields.gas_price),
    ...(fields.type === undefined ? {} : { type: fields.type }),
    delegates: fields.authorization_list !== undefined,
  }));

// Privy's Node SDK adds `chain_type: "ethereum"` to every Ethereum call it sends; Privy's API
// takes it, and custody signs through the SDK.
const bodySchema = z.strictObject({
  method: z.string(),
  params: z.json(),
  chain_type: z.literal("ethereum").exactOptional(),
});
const paramsSchema = z.strictObject({ transaction: z.json() });

/**
 * Reads a Privy request body: an `eth_signTransaction` call and its transaction, a call of another
 * method, or a body the signer cannot read.
 */
export function readPrivyCall(body: JsonValue): PrivyCall {
  const call = bodySchema.safeParse(body);
  if (!call.success) {
    return { kind: "unreadable" };
  }
  if (call.data.method !== "eth_signTransaction") {
    return { kind: "otherMethod" };
  }
  const params = paramsSchema.safeParse(call.data.params);
  const transaction = transactionSchema.safeParse(params.success ? params.data.transaction : null);
  return transaction.success
    ? { kind: "transaction", transaction: transaction.data }
    : { kind: "unreadable" };
}
