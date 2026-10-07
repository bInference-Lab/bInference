import { decimalStringSchema } from "@binference/core";
import { z } from "zod";
import { isTxHash, type TxHash } from "../transaction.js";

/** A block, by its number and its hash, which changes when a reorg replaces the block. */
export interface BlockRef {
  readonly number: bigint;
  readonly hash: string;
}

/** What the chain records about a transaction a block holds. */
export interface TxReceipt {
  readonly hash: TxHash;
  readonly block: BlockRef;
  /** `reverted` when the transaction ran and failed: it used its nonce and paid its fee. */
  readonly status: "success" | "reverted";
  /** The work the transaction used, in its family's own unit: gas on an EVM chain. */
  readonly gasUsed: bigint;
  /** What one unit of that work cost, in base units of the chain's native coin. */
  readonly feePerGasBase: bigint;
}

/** A {@link TxReceipt} as JSON carries it: numbers as decimal strings. */
export interface TxReceiptWire {
  readonly hash: string;
  readonly block: { readonly number: string; readonly hash: string };
  readonly status: "success" | "reverted";
  readonly gasUsed: string;
  readonly feePerGasBase: string;
}

/** A chain's latest block, and its final block by the chain's finality rule. */
export interface ChainHead {
  readonly latest: bigint;
  /** Every block at or below this one is final: no reorg replaces it. */
  readonly final: bigint;
}

const blockHashSchema = z.string().regex(/^[-.%a-zA-Z0-9]{1,128}$/);

/** Decodes a {@link TxReceipt} from JSON, and encodes it back with `z.encode`. */
export const txReceiptSchema: z.ZodType<TxReceipt, TxReceiptWire> = z.strictObject({
  hash: z.string().refine(isTxHash),
  block: z.strictObject({ number: decimalStringSchema, hash: blockHashSchema }),
  status: z.enum(["success", "reverted"]),
  gasUsed: decimalStringSchema,
  feePerGasBase: decimalStringSchema,
});
