import {
  type AccountRef,
  accountRefSchema,
  isTxHash,
  relayNameSchema,
  type TxHash,
  type TxReceipt,
} from "@binference/chain";
import { type Id, idSchema } from "@binference/core";
import { z } from "zod";
import { epochMsSchema, pageLimitSchema } from "../records/record-fields.js";

// The states of a step's transaction (spec 6, section 6).
const transactionStates = [
  "built",
  "signed",
  "sent",
  "included",
  "final",
  "reverted",
  "dropped",
  "superseded",
] as const;

/** The state of a step's transaction. */
export type TransactionState = (typeof transactionStates)[number];

/** A nonce: a safe integer at 0 or above. */
export const nonceSchema: z.ZodType<number, number> = z.int().nonnegative();

/** One step's transaction, signed, as the wallet queue stores it before any send. */
export interface SignedTransaction {
  readonly id: Id<"tx">;
  readonly intentId: Id<"int">;
  /** The step's place in its intent's plan, from 0. */
  readonly step: number;
  /** The account that signs and pays, in the form its wallet queue keys on. */
  readonly account: AccountRef;
  readonly nonce: number;
  /** The signed bytes in the family's own encoding, as the relays get them. */
  readonly raw: string;
  readonly hash: TxHash;
  readonly signedAtMs: number;
}

const signedShape = {
  id: idSchema("tx"),
  intentId: idSchema("int"),
  step: z.int().nonnegative(),
  account: accountRefSchema,
  nonce: nonceSchema,
  raw: z.string().min(1),
  hash: z.string().refine(isTxHash),
  signedAtMs: epochMsSchema,
};

/** Parses a signed transaction. */
export const signedTransactionSchema: z.ZodType<SignedTransaction> = z.strictObject(signedShape);

/** A stored transaction, its state, and what its sends and blocks recorded. */
export interface TransactionRecord extends SignedTransaction {
  readonly state: TransactionState;
  /** The relays it was sent to, from its first send on: a later send goes to the same ones. */
  readonly relays?: readonly string[];
  /** When a relay first accepted it. */
  readonly sentAtMs?: number;
  /** Its receipt, while a block holds it: in `included`, `final` and `reverted`. */
  readonly receipt?: TxReceipt;
  /** When its receipt was recorded. */
  readonly includedAtMs?: number;
  /** When its block was recorded as final. */
  readonly finalAtMs?: number;
}

/** Parses a receipt as stored values carry it, numbers as bigints. */
export const storedReceiptSchema: z.ZodType<TxReceipt> = z.strictObject({
  hash: z.string().refine(isTxHash),
  block: z.strictObject({
    number: z.bigint().nonnegative(),
    hash: z.string().regex(/^[-.%a-zA-Z0-9]{1,128}$/),
  }),
  status: z.enum(["success", "reverted"]),
  gasUsed: z.bigint().nonnegative(),
  feePerGasBase: z.bigint().nonnegative(),
});

/** Parses a stored transaction. */
export const transactionRecordSchema: z.ZodType<TransactionRecord> = z.strictObject({
  ...signedShape,
  state: z.enum(transactionStates),
  relays: z.array(relayNameSchema).min(1).exactOptional(),
  sentAtMs: epochMsSchema.exactOptional(),
  receipt: storedReceiptSchema.exactOptional(),
  includedAtMs: epochMsSchema.exactOptional(),
  finalAtMs: epochMsSchema.exactOptional(),
});

/** One account's transactions from nonce `fromNonce` up, at most `limit`, by nonce. */
export interface TransactionQuery {
  readonly account: AccountRef;
  readonly fromNonce: number;
  readonly limit: number;
}

/** Parses a transaction query. */
export const transactionQuerySchema: z.ZodType<TransactionQuery> = z.strictObject({
  account: accountRefSchema,
  fromNonce: nonceSchema,
  limit: pageLimitSchema,
});
