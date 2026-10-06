import { type Id, idSchema } from "@binference/core";
import { z } from "zod";
import { epochMsSchema } from "../records/record-fields.js";
import { type Sha256Hex, sha256HexSchema } from "../records/sha256-hex.js";

/**
 * Why a card version closed: the owner's answer, the card timer, a cancel, or a worse re-quote
 * that opened the next version.
 */
export const cardCloseReasons = [
  "confirmed",
  "denied",
  "expired",
  "cancelled",
  "replaced",
] as const;

/** Why a card version closed. */
export type CardCloseReason = (typeof cardCloseReasons)[number];

/** A new card version, written with the move that opens it. */
export interface CardOpening {
  readonly id: Id<"crd">;
  /** 1 for the first card of an intent, one more for each version after it. */
  readonly version: number;
  /** SHA-256 over the stable JSON of what the card shows; the signer checks it. */
  readonly termsHash: Sha256Hex;
  /**
   * The random reference a Telegram button carries (spec 4, section 2): 12 bytes in base64url.
   * Absent for a card no button points at.
   */
  readonly callbackRef?: string;
  readonly openedAtMs: number;
  /** No answer by then is a no. */
  readonly expiresAtMs: number;
}

const cardOpeningShape = {
  id: idSchema("crd"),
  version: z.int().positive(),
  termsHash: sha256HexSchema,
  callbackRef: z
    .string()
    .regex(/^[\w-]{16}$/, { message: "Expected 12 bytes in base64url." })
    .exactOptional(),
  openedAtMs: epochMsSchema,
  expiresAtMs: epochMsSchema,
};

/** Parses a new card version. */
export const cardOpeningSchema: z.ZodType<CardOpening> = z.strictObject(cardOpeningShape);

/** Closes one open card version of the intent, at the time of the move that closes it. */
export interface CardVersionClosing {
  readonly id: Id<"crd">;
  readonly reason: CardCloseReason;
}

/** Parses a card closing. */
export const cardVersionClosingSchema: z.ZodType<CardVersionClosing> = z.strictObject({
  id: idSchema("crd"),
  reason: z.enum(cardCloseReasons),
});

/** One card version as the store keeps it. A closed version keeps when and why it closed. */
export interface CardRecord extends CardOpening {
  readonly intentId: Id<"int">;
  readonly closedAtMs?: number;
  readonly closeReason?: CardCloseReason;
}

/** Parses a card record. */
export const cardRecordSchema: z.ZodType<CardRecord> = z.strictObject({
  ...cardOpeningShape,
  intentId: idSchema("int"),
  closedAtMs: epochMsSchema.exactOptional(),
  closeReason: z.enum(cardCloseReasons).exactOptional(),
});
