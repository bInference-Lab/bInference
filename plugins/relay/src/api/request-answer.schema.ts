import { parseJsonText } from "@binference/plugin-sdk/data";
import type { Hex } from "viem";
import { z } from "zod";
import { word32TextSchema } from "../wire-values.schema.js";

/** A transaction a Relay request names, on the chain of its numeric id. */
export interface RelayTx {
  readonly chainId: bigint;
  /** A 32-byte hash on an EVM chain, a base58 signature on Solana, as written. */
  readonly hash: string;
}

/**
 * Relay's word on one request, from its requests endpoint: its id, its status, the transactions
 * that paid in and out, and whether Relay said no refund will follow a failed fill.
 */
export interface RelayRequest {
  readonly id: Hex;
  readonly status:
    | "waiting"
    | "depositing"
    | "pending"
    | "submitted"
    | "success"
    | "failure"
    | "refund";
  readonly inTxs: readonly RelayTx[];
  readonly outTxs: readonly RelayTx[];
  /** Relay's code for why no refund follows a failed fill; absent while one may. */
  readonly refundFailReason?: string;
}

const chainId = z
  .string()
  .regex(/^[1-9]\d{0,30}$/)
  .transform((text) => BigInt(text));
const hash = z.string().regex(/^(?:0x[0-9a-fA-F]{64}|[1-9A-HJ-NP-Za-km-z]{43,88})$/);

// Version 2 names a transaction's hash `hash`, version 3 `txHash` (Relay's migration guide).
const txSchema = z
  .looseObject({ chainId, hash: hash.optional(), txHash: hash.optional() })
  .transform((tx, context): RelayTx => {
    const named = tx.hash ?? tx.txHash;
    if (named === undefined) {
      context.addIssue({ code: "custom", message: "A transaction names no hash." });
      return z.NEVER;
    }
    return { chainId: tx.chainId, hash: named };
  });

// Version 2 writes "N/A" where version 3 writes null: neither is a reason.
const reason = z
  .string()
  .max(64)
  .nullish()
  .transform((text) => (text === null || text === undefined || text === "N/A" ? undefined : text));

const requestSchema = z.looseObject({
  id: word32TextSchema,
  status: z.enum(["waiting", "depositing", "pending", "submitted", "success", "failure", "refund"]),
  data: z.looseObject({
    inTxs: z.array(txSchema).max(16),
    outTxs: z.array(txSchema).max(16),
    refundFailReason: reason,
  }),
});

const answerSchema = z.looseObject({ requests: z.array(requestSchema).max(16) });

/**
 * Reads a requests answer filtered by one deposit's transaction: the requests it holds, none
 * while Relay has not seen the deposit; `undefined` when it breaks the schema.
 */
export function readRequestsAnswer(body: string): readonly RelayRequest[] | undefined {
  const parsed = answerSchema.safeParse(parseJsonText(body));
  if (!parsed.success) {
    return undefined;
  }
  return parsed.data.requests.map(requestOf);
}

function requestOf(request: z.output<typeof requestSchema>): RelayRequest {
  const { inTxs, outTxs, refundFailReason } = request.data;
  const read = { id: request.id, status: request.status, inTxs, outTxs };
  return refundFailReason === undefined ? read : { ...read, refundFailReason };
}
