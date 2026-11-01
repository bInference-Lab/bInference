import type { Address } from "viem";
import { z } from "zod";
import { addressTextSchema, unsignedTextSchema } from "../wire-values.schema.js";

/**
 * A quote's record for the build: what it was asked (the depositor, the recipient, both tokens,
 * the input and the destination), so a build for another request is refused, and the deposit terms
 * only Across sets: the output a fill pays, the relayer with the first right to fill, and the
 * quote's timing.
 */
export interface DepositRecord {
  readonly depositor: Address;
  readonly recipient: Address;
  readonly inputToken: Address;
  readonly outputToken: Address;
  readonly inputAmount: bigint;
  readonly destinationChainId: bigint;
  readonly outputAmount: bigint;
  readonly exclusiveRelayer: Address;
  readonly quoteTimestamp: number;
  readonly fillDeadline: number;
  readonly exclusivityParameter: number;
}

// Unix seconds or a count of them, as a uint32 holds it.
const uint32 = z.int().nonnegative().max(0xffff_ffff);

const unsigned = unsignedTextSchema;
const address = addressTextSchema;

const recordSchema = z.strictObject({
  depositor: address,
  recipient: address,
  inputToken: address,
  outputToken: address,
  inputAmount: unsigned,
  destinationChainId: unsigned,
  outputAmount: unsigned,
  exclusiveRelayer: address,
  quoteTimestamp: uint32,
  fillDeadline: uint32,
  exclusivityParameter: uint32,
});

/** The record as the quote carries it. */
export function writeDepositRecord(record: DepositRecord): string {
  return JSON.stringify({
    depositor: record.depositor,
    recipient: record.recipient,
    inputToken: record.inputToken,
    outputToken: record.outputToken,
    inputAmount: record.inputAmount.toString(),
    destinationChainId: record.destinationChainId.toString(),
    outputAmount: record.outputAmount.toString(),
    exclusiveRelayer: record.exclusiveRelayer,
    quoteTimestamp: record.quoteTimestamp,
    fillDeadline: record.fillDeadline,
    exclusivityParameter: record.exclusivityParameter,
  });
}

/** Reads a quote's record back, or `undefined` for a quote without one or another text. */
export function readDepositRecord(text: string | undefined): DepositRecord | undefined {
  if (text === undefined) {
    return undefined;
  }
  try {
    const parsed = recordSchema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}
