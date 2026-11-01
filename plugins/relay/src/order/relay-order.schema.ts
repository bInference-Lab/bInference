import { decimalStringSchema } from "@binference/plugin-sdk";
import type { Hex } from "viem";
import { z } from "zod";
import {
  evmAddressTextSchema,
  lowerHex,
  bytesTextSchema,
  word32TextSchema,
} from "../wire-values.schema.js";

/** A refund an order allows: the chain, who it pays, in which token, at least how much, by when. */
export interface OrderRefund {
  readonly chainId: string;
  readonly recipient: string;
  readonly currency: string;
  readonly minimumAmount: bigint;
  readonly deadline: number;
  readonly extraData: Hex;
}

/**
 * A Relay order as its quote's `protocol.v2.orderData` writes it, version 1, in the shape the bridge
 * takes: one input it pays, one payment on the output chain, no call there and no fee of its own.
 * Addresses stay as the order writes them: lowercase hex on an EVM chain, base58 on Solana.
 */
export interface RelayOrder {
  readonly version: "v1";
  readonly solverChainId: string;
  readonly solver: Hex;
  readonly salt: bigint;
  readonly input: {
    readonly chainId: string;
    readonly currency: string;
    readonly amount: bigint;
    readonly weight: bigint;
  };
  readonly refunds: readonly OrderRefund[];
  readonly output: {
    readonly chainId: string;
    readonly recipient: string;
    readonly currency: string;
    readonly minimumAmount: bigint;
    readonly expectedAmount: bigint;
    readonly deadline: number;
    readonly extraData: Hex;
  };
}

const chainName = z.string().regex(/^[a-z0-9-]{1,64}$/);
// An address of any chain Relay names: hex on an EVM chain, base58 on Solana. The order id's
// encoding checks each against its chain.
const account = z.string().regex(/^(?:0x[0-9a-fA-F]{40}|[1-9A-HJ-NP-Za-km-z]{32,44})$/);
// Unix seconds as a uint32 holds them, written as the text the answer wrote (`parseJsonText`).
const uint32 = z
  .string()
  .regex(/^(?:0|[1-9]\d{0,9})$/)
  .pipe(z.coerce.number<string>().max(0xffff_ffff));
const salt = word32TextSchema.transform((text) => BigInt(text));

const refundSchema = z.strictObject({
  chainId: chainName,
  recipient: account,
  currency: account,
  minimumAmount: decimalStringSchema,
  deadline: uint32,
  extraData: bytesTextSchema,
});

const orderSchema = z.strictObject({
  version: z.literal("v1"),
  solverChainId: chainName,
  solver: evmAddressTextSchema.transform((address) => lowerHex(address)),
  salt,
  // One input, one payment, no call and no fee: anything else is an order the bridge never pays.
  inputs: z.tuple([
    z.strictObject({
      payment: z.strictObject({
        chainId: chainName,
        currency: account,
        amount: decimalStringSchema,
        weight: decimalStringSchema,
      }),
      refunds: z.array(refundSchema).min(1).max(4),
    }),
  ]),
  output: z.strictObject({
    chainId: chainName,
    payments: z.tuple([
      z.strictObject({
        recipient: account,
        currency: account,
        minimumAmount: decimalStringSchema,
        expectedAmount: decimalStringSchema,
      }),
    ]),
    calls: z.tuple([]),
    deadline: uint32,
    extraData: bytesTextSchema,
  }),
  fees: z.tuple([]),
});

/** Decodes `protocol.v2.orderData` from a quote, or fails for an order outside that shape. */
export const relayOrderSchema: z.ZodType<RelayOrder> = orderSchema.transform(
  (order): RelayOrder => {
    const [{ payment, refunds }] = order.inputs;
    const [paid] = order.output.payments;
    return {
      version: order.version,
      solverChainId: order.solverChainId,
      solver: order.solver,
      salt: order.salt,
      input: payment,
      refunds,
      output: {
        chainId: order.output.chainId,
        ...paid,
        deadline: order.output.deadline,
        extraData: order.output.extraData,
      },
    };
  },
);
