import { type AccountRef, accountRefSchema, isTxHash, type TxHash } from "@binference/chain";
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

/** A stored transaction and its state. */
export interface TransactionRecord extends SignedTransaction {
  readonly state: TransactionState;
}

/** Parses a stored transaction. */
export const transactionRecordSchema: z.ZodType<TransactionRecord> = z.strictObject({
  ...signedShape,
  state: z.enum(transactionStates),
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
