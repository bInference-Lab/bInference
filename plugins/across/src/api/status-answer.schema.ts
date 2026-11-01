import { parseJsonText } from "@binference/plugin-sdk/data";
import { type Hex } from "viem";
import { z } from "zod";

/**
 * Across's word on one deposit, from its deposit status endpoint: the deposit's own transaction and
 * chains, and the fill or the refund once there is one. `received` and `slowFillRequested` are
 * Across's steps before a fill, read as pending.
 */
export interface AcrossDepositAnswer {
  readonly status: "pending" | "filled" | "expired" | "refunded";
  readonly originChainId: bigint;
  readonly destinationChainId: bigint;
  readonly depositTxHash: Hex;
  readonly fillTx?: Hex;
  readonly depositRefundTxHash?: Hex;
}

const hash = z
  .string()
  .regex(/^0x[0-9a-fA-F]{64}$/)
  .transform((text): Hex => `0x${text.slice(2).toLowerCase()}`);
const chainId = z
  .string()
  .regex(/^[1-9]\d{0,30}$/)
  .transform((text) => BigInt(text));
const status = z
  .enum(["pending", "received", "slowFillRequested", "filled", "expired", "refunded"])
  .transform((text) => (text === "received" || text === "slowFillRequested" ? "pending" : text));

const answerSchema = z.looseObject({
  status,
  originChainId: chainId,
  destinationChainId: chainId,
  depositTxHash: hash,
  fillTx: hash.nullish(),
  depositRefundTxHash: hash.nullish(),
});

const notFoundSchema = z.looseObject({ error: z.literal("DepositNotFoundException") });

/**
 * Reads a deposit status answer, or `undefined` when it breaks the schema. A filled deposit names
 * its fill and a refunded one its refund, else it does not read.
 */
export function readDepositAnswer(body: string): AcrossDepositAnswer | undefined {
  const parsed = answerSchema.safeParse(parseJsonText(body));
  if (!parsed.success) {
    return undefined;
  }
  const { fillTx, depositRefundTxHash, ...answer } = parsed.data;
  const isComplete =
    (answer.status !== "filled" || fillTx != null) &&
    (answer.status !== "refunded" || depositRefundTxHash != null);
  return isComplete
    ? {
        ...answer,
        ...(fillTx == null ? {} : { fillTx }),
        ...(depositRefundTxHash == null ? {} : { depositRefundTxHash }),
      }
    : undefined;
}

/** Whether an answer is Across's "deposit not found", which it gives until its indexer saw it. */
export function isDepositNotFound(body: string): boolean {
  return notFoundSchema.safeParse(parseJsonText(body)).success;
}
