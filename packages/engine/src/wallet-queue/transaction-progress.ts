import { type RelayAnswer, relayAnswerSchema, type TxReceipt } from "@binference/chain";
import { type Id, idSchema } from "@binference/core";
import { z } from "zod";
import { epochMsSchema } from "../records/record-fields.js";
import { storedReceiptSchema, type TransactionState } from "./transaction-record.js";

/** One send of a stored transaction: each relay's answer, in the order of its relays. */
export interface TransactionSend {
  readonly id: Id<"tx">;
  readonly answers: readonly RelayAnswer[];
}

/** Parses a transaction send: at least one answer, each relay once. */
export const transactionSendSchema: z.ZodType<TransactionSend> = z.strictObject({
  id: idSchema("tx"),
  answers: z
    .array(relayAnswerSchema)
    .min(1)
    .refine(
      (answers: readonly RelayAnswer[]) =>
        new Set(answers.map(({ relay }) => relay)).size === answers.length,
      {
        message: "A relay answers once per send.",
      },
    ),
});

/** A block holds a stored transaction: its receipt, as read at `atMs`. */
export interface TransactionInclusion {
  readonly id: Id<"tx">;
  readonly receipt: TxReceipt;
  readonly atMs: number;
}

/** Parses a transaction inclusion. */
export const transactionInclusionSchema: z.ZodType<TransactionInclusion> = z.strictObject({
  id: idSchema("tx"),
  receipt: storedReceiptSchema,
  atMs: epochMsSchema,
});

/** A stored transaction at one moment: its block turned final, or a reorg took the block. */
export interface TransactionMark {
  readonly id: Id<"tx">;
  readonly atMs: number;
}

/** Parses a transaction mark. */
export const transactionMarkSchema: z.ZodType<TransactionMark> = z.strictObject({
  id: idSchema("tx"),
  atMs: epochMsSchema,
});

/**
 * What happened to a stored transaction: a send (`accepted` when a relay took it), a receipt with
 * its status, its block turned final, a reorg that took its block, or another transaction that
 * took its nonce.
 */
export type TransactionProgress =
  | { readonly kind: "send"; readonly accepted: boolean }
  | { readonly kind: "receipt"; readonly status: TxReceipt["status"] }
  | { readonly kind: "final" }
  | { readonly kind: "reorg" }
  | { readonly kind: "superseded" };

// The states each kind of progress may move a transaction from. A transaction another one
// replaced, or one the relays dropped, may still land: its bytes were sent.
const movesFrom: Readonly<Record<TransactionProgress["kind"], readonly TransactionState[]>> = {
  send: ["signed", "sent"],
  receipt: ["signed", "sent", "included", "reverted", "superseded", "dropped"],
  final: ["included"],
  reorg: ["included", "reverted"],
  superseded: ["signed", "sent"],
};

function targetOf(state: TransactionState, progress: TransactionProgress): TransactionState {
  if (progress.kind === "send") {
    return progress.accepted ? "sent" : state;
  }
  if (progress.kind === "receipt") {
    return progress.status === "success" ? "included" : "reverted";
  }
  if (progress.kind === "superseded") {
    return "superseded";
  }
  return progress.kind === "final" ? "final" : "sent";
}

/**
 * The state a stored transaction moves to (spec 6, section 6), or `undefined` when it cannot move
 * from where it is. A send keeps a `signed` transaction there until a relay accepts it, and may
 * go again for a `sent` one; a receipt makes a sent, or still signed, transaction `included` or
 * `reverted`, and a later receipt of an included one moves it to the block that holds it now; only
 * an `included` transaction turns `final`; a reorg sends an included or reverted one back to
 * `sent`; another transaction at its nonce makes a signed or sent one `superseded`. Only a receipt
 * moves a `dropped` or `superseded` transaction, which landed after all, and nothing moves a
 * `final` one. The memory fake and the SQLite store both decide by this rule.
 */
export function progressedState(
  state: TransactionState,
  progress: TransactionProgress,
): TransactionState | undefined {
  return movesFrom[progress.kind].includes(state) ? targetOf(state, progress) : undefined;
}
