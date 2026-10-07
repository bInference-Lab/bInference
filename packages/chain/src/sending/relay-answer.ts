import { z } from "zod";

/**
 * Why a private relay refused a transaction:
 * - `nonce_too_low`: a block already holds a transaction of the sender at this nonce;
 * - `underpriced`: the fee per gas is below what the relay or the chain takes;
 * - `replacement_underpriced`: the relay holds a transaction at this nonce and the new fee is not
 *   enough higher to replace it;
 * - `insufficient_funds`: the sender cannot pay the value and the fee;
 * - `gas_quota`: the relay's quota of gas for low-fee transactions is spent;
 * - `malformed_transaction`: the relay cannot read the signed bytes, or their chain or sender;
 * - `rate_limited`: the relay answered with its rate limit;
 * - `bad_answer`: the relay answered outside its protocol, or with another transaction's hash;
 * - `rejected`: any other refusal; its code says which.
 */
export const relayRefusals = [
  "nonce_too_low",
  "underpriced",
  "replacement_underpriced",
  "insufficient_funds",
  "gas_quota",
  "malformed_transaction",
  "rate_limited",
  "bad_answer",
  "rejected",
] as const;

/** Why a private relay refused a transaction. */
export type RelayRefusal = (typeof relayRefusals)[number];

/** A relay that took the transaction, or already held it. */
export interface RelayAccepted {
  readonly relay: string;
  readonly outcome: "accepted";
  readonly atMs: number;
}

/** A relay that refused the transaction, with the code it answered when it gave one. */
export interface RelayRefused {
  readonly relay: string;
  readonly outcome: "refused";
  readonly reason: RelayRefusal;
  /** The relay's own error code or HTTP status, for logs; never shown as the reason. */
  readonly code?: number;
  readonly atMs: number;
}

/** A relay that gave no answer in time, or could not be reached at all. */
export interface RelaySilent {
  readonly relay: string;
  readonly outcome: "timed_out" | "unreachable";
  readonly atMs: number;
}

/**
 * What one private relay answered to one send of a signed transaction, and when the answer came
 * (or the wait for it ended), in epoch milliseconds. Each answer is stored per relay.
 */
export type RelayAnswer = RelayAccepted | RelayRefused | RelaySilent;

/** A relay's name: a chain definition's endpoint name, or the host of a relay config adds. */
export const relayNameSchema: z.ZodType<string, string> = z
  .string()
  .regex(/^[a-z0-9](?:[a-z0-9.-]{0,62}[a-z0-9])?$/);

const atMsSchema = z.int().nonnegative();

/** Parses a {@link RelayAnswer}; its JSON is the answer itself. */
export const relayAnswerSchema: z.ZodType<RelayAnswer, RelayAnswer> = z.discriminatedUnion(
  "outcome",
  [
    z.strictObject({ relay: relayNameSchema, outcome: z.literal("accepted"), atMs: atMsSchema }),
    z.strictObject({
      relay: relayNameSchema,
      outcome: z.literal("refused"),
      reason: z.enum(relayRefusals),
      code: z.int().exactOptional(),
      atMs: atMsSchema,
    }),
    z.strictObject({ relay: relayNameSchema, outcome: z.literal("timed_out"), atMs: atMsSchema }),
    z.strictObject({ relay: relayNameSchema, outcome: z.literal("unreachable"), atMs: atMsSchema }),
  ],
);
