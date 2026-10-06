import { type Id, idSchema } from "@binference/core";
import { z } from "zod";
import { epochMsSchema, shortTextSchema } from "../records/record-fields.js";
import { type Sha256Hex, sha256HexSchema } from "../records/sha256-hex.js";

/** The owner's yes to one card version, written with the move to `confirmed`. */
export interface ConfirmationDraft {
  readonly id: Id<"cnf">;
  readonly cardId: Id<"crd">;
  readonly cardVersion: number;
  /** The terms hash of the card version the owner saw. */
  readonly termsHash: Sha256Hex;
  /** The surface the owner answered on, such as `telegram` or `console`. */
  readonly bySurface: string;
  /** Who answered there: the Telegram user id, the console device or the client token. */
  readonly byRef: string;
  /** After this the confirmation no longer authorizes a signature. */
  readonly expiresAtMs: number;
}

const draftShape = {
  id: idSchema("cnf"),
  cardId: idSchema("crd"),
  cardVersion: z.int().positive(),
  termsHash: sha256HexSchema,
  bySurface: shortTextSchema,
  byRef: shortTextSchema,
  expiresAtMs: epochMsSchema,
};

/** Parses a confirmation draft. */
export const confirmationDraftSchema: z.ZodType<ConfirmationDraft> = z.strictObject(draftShape);

/** A confirmation as the store keeps it: one per intent, at most. */
export interface StoredConfirmation extends ConfirmationDraft {
  readonly intentId: Id<"int">;
  readonly atMs: number;
}

/** Parses a confirmation record. */
export const storedConfirmationSchema: z.ZodType<StoredConfirmation> = z.strictObject({
  ...draftShape,
  intentId: idSchema("int"),
  atMs: epochMsSchema,
});
