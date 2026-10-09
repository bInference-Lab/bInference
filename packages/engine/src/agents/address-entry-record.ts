import { type AccountRef, accountRefSchema } from "@binference/chain";
import { type Id, idSchema } from "@binference/core";
import { z } from "zod";
import { epochMsSchema, shortTextSchema } from "../records/record-fields.js";

/**
 * One entry of an agent's address book (database spec, section 2.2, `address_book`): an address a
 * send may pay, with its label. The store lists live entries only.
 */
export interface AddressEntryRecord {
  readonly id: Id<"adr">;
  readonly agentId: Id<"agt">;
  /** The address on its chain, in the chain family's canonical form. */
  readonly account: AccountRef;
  readonly label: string;
  /**
   * From when send level 2 lets a send pay it: 24 hours after the owner key saved it in the
   * ceiling (spec 5, section 4).
   */
  readonly usableAtMs: number;
  /** When the owner key saved it in the ceiling (decision 0091); absent while it is not saved. */
  readonly inCeilingAtMs?: number;
  readonly createdAtMs: number;
}

/** Parses an address book entry, as it is added and as the store lists it. */
export const addressEntryRecordSchema: z.ZodType<AddressEntryRecord> = z.strictObject({
  id: idSchema("adr"),
  agentId: idSchema("agt"),
  account: accountRefSchema,
  label: shortTextSchema,
  usableAtMs: epochMsSchema,
  inCeilingAtMs: epochMsSchema.exactOptional(),
  createdAtMs: epochMsSchema,
});

/** The removal of one address book entry at `atMs`. */
export interface AddressEntryRemoval {
  readonly id: Id<"adr">;
  readonly atMs: number;
}

/** Parses an address book entry's removal. */
export const addressEntryRemovalSchema: z.ZodType<AddressEntryRemoval> = z.strictObject({
  id: idSchema("adr"),
  atMs: epochMsSchema,
});
