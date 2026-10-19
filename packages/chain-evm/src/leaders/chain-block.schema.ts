import { isTxHash, type TxHash } from "@binference/chain";
import type { Address, Hex } from "viem";
import { z } from "zod";
import { addressSchema, hexSchema, quantitySchema } from "../rpc/evm-wire.schema.js";

/** A log of a mined block, as `eth_getLogs` answers it. */
export interface ChainLog {
  readonly address: Address;
  readonly topics: readonly Hex[];
  readonly data: Hex;
  readonly blockNumber: bigint;
  readonly blockHash: Hex;
  readonly transactionHash: TxHash;
  readonly logIndex: number;
  /** The block that held it is no longer on the chain. */
  readonly removed: boolean;
}

/** A block's place on the chain: its number, hash, parent and time. */
export interface BlockHeader {
  readonly number: bigint;
  readonly hash: Hex;
  readonly parentHash: Hex;
  readonly timestampMs: number;
}

/** What the leader watcher reads of a transaction: who sent it, to whom, with what value. */
export interface BlockTransaction {
  readonly hash: TxHash;
  readonly from: Address;
  /** Absent for a contract creation. */
  readonly to?: Address;
  readonly value: bigint;
}

/** A block with its transactions. */
export interface BlockFacts extends BlockHeader {
  readonly transactions: readonly BlockTransaction[];
}

// A quantity small enough for a number, such as a log's index or a block's time in seconds.
const smallNumberSchema = quantitySchema.pipe(z.coerce.number()).pipe(z.int().nonnegative());
const hashSchema = z.string().regex(/^0x[0-9a-fA-F]{64}$/);
const txHashSchema = hashSchema.refine(isTxHash);
const blockHashSchema = hexSchema.refine((text) => hashSchema.safeParse(text).success);

/** Checks one log of an `eth_getLogs` answer. */
export const chainLogSchema: z.ZodType<ChainLog> = z
  .looseObject({
    address: addressSchema,
    topics: z.array(hexSchema),
    data: hexSchema,
    blockNumber: quantitySchema,
    blockHash: blockHashSchema,
    transactionHash: txHashSchema,
    logIndex: smallNumberSchema,
    removed: z.boolean().optional(),
  })
  .transform(({ removed, ...log }) => ({ ...log, removed: removed === true }));

const headerShape = {
  number: quantitySchema,
  hash: blockHashSchema,
  parentHash: blockHashSchema,
  timestamp: smallNumberSchema,
};

function headerOf(block: {
  readonly number: bigint;
  readonly hash: Hex;
  readonly parentHash: Hex;
  readonly timestamp: number;
}): BlockHeader {
  const { number, hash, parentHash, timestamp } = block;
  return { number, hash, parentHash, timestampMs: timestamp * 1_000 };
}

/** Checks a block header, as `eth_getBlockByNumber` answers it without transactions. */
export const blockHeaderSchema: z.ZodType<BlockHeader> = z
  .looseObject(headerShape)
  .transform(headerOf);

const transactionSchema = z
  .looseObject({
    hash: txHashSchema,
    from: addressSchema,
    to: addressSchema.nullable(),
    value: quantitySchema,
  })
  .transform(({ hash, from, to, value }) => ({
    hash,
    from,
    value,
    ...(to === null ? {} : { to }),
  }));

/** Checks a block with its transactions, as `eth_getBlockByNumber` answers it with them. */
export const blockFactsSchema: z.ZodType<BlockFacts> = z
  .looseObject({ ...headerShape, transactions: z.array(transactionSchema) })
  .transform((block) => ({ ...headerOf(block), transactions: block.transactions }));
