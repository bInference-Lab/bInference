import type { Address, Hex } from "viem";
import { z } from "zod";
import { addressSchema, hexSchema, quantitySchema } from "../rpc/evm-wire.schema.js";

/** A log a simulated call emitted. */
export interface EvmLog {
  readonly address: Address;
  readonly topics: readonly Hex[];
  readonly data: Hex;
}

/** One call of an `eth_simulateV1` block, as the node answers it. */
export interface SimulatedCallReply {
  /** 1 for success, 0 for a revert. */
  readonly status: bigint;
  readonly gasUsed: bigint;
  readonly returnData: Hex;
  readonly logs: readonly EvmLog[];
}

/** One simulated block, as the node answers it. */
export interface SimulatedBlockReply {
  readonly number: bigint;
  readonly calls: readonly SimulatedCallReply[];
}

const logSchema = z.looseObject({
  address: addressSchema,
  topics: z.array(hexSchema),
  data: hexSchema,
});

const callSchema = z.looseObject({
  status: quantitySchema,
  gasUsed: quantitySchema,
  returnData: hexSchema,
  logs: z.array(logSchema),
});

/** Checks the result of an `eth_simulateV1` request for one block. */
export const simulationReplySchema: z.ZodType<readonly SimulatedBlockReply[]> = z
  .array(z.looseObject({ number: quantitySchema, calls: z.array(callSchema) }))
  .length(1);
