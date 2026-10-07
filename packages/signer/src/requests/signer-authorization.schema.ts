import { type Id, idSchema } from "@binference/core";
import { z } from "zod";
import {
  type ApprovalModeNow,
  approvalModeNowSchema,
  type ApprovalModeNowWire,
  type AutoModeGrant,
  autoModeGrantSchema,
  type AutoModeGrantWire,
} from "./auto-mode-grant.schema.js";

/** The life of an auto order or a webhook rule, as the engine read it right before signing. */
export interface AdvanceAuthorization {
  /** `active` while it may fill; any other state authorizes nothing. */
  readonly state: string;
  readonly termsHash: string;
  /** After this the order or rule authorizes nothing; none when it never expires. */
  readonly expiresAtMs?: number;
  /** The fills it made so far. */
  readonly fills: number;
  /** The most fills it may make; none when it has no such bound. */
  readonly maxFills?: number;
}

/**
 * What approved the intent a transaction belongs to, with the facts the hard rules check (keys
 * spec, section 5.2, rule 5): the owner's confirmation of its card, an auto order or a webhook rule
 * the owner confirmed in advance, or the agent's auto mode: its grant for the intent and the mode
 * as it stands. The terms hash is that of what the owner confirmed, or of the intent that passed
 * the auto test.
 */
export type SignerAuthorization =
  | {
      readonly kind: "confirmation";
      readonly id: Id<"cnf">;
      readonly intent: Id<"int">;
      readonly termsHash: string;
      /** After this the confirmation authorizes no signature. */
      readonly expiresAtMs: number;
    }
  | ({ readonly kind: "order"; readonly id: Id<"ord"> } & AdvanceAuthorization)
  | ({ readonly kind: "webhookRule"; readonly id: Id<"whr"> } & AdvanceAuthorization)
  | {
      readonly kind: "approvalMode";
      readonly grant: AutoModeGrant;
      readonly current: ApprovalModeNow;
    };

/** A {@link AdvanceAuthorization} with its kind and id, as JSON carries it. */
interface AdvanceWire extends AdvanceAuthorization {
  readonly kind: "order" | "webhookRule";
  readonly id: string;
}

/** A {@link SignerAuthorization} as JSON carries it: ids as text, amounts as decimal strings. */
export type SignerAuthorizationWire =
  | {
      readonly kind: "confirmation";
      readonly id: string;
      readonly intent: string;
      readonly termsHash: string;
      readonly expiresAtMs: number;
    }
  | AdvanceWire
  | {
      readonly kind: "approvalMode";
      readonly grant: AutoModeGrantWire;
      readonly current: ApprovalModeNowWire;
    };

/** A SHA-256 as 64 lowercase hex characters, as the store keeps a terms hash. */
export const termsHashSchema: z.ZodType<string, string> = z.string().regex(/^[0-9a-f]{64}$/);

const epochMsSchema = z.int().nonnegative();
const countSchema = z.int().nonnegative();

const advanceShape = {
  state: z.string().regex(/^[a-z_]{1,32}$/),
  termsHash: termsHashSchema,
  expiresAtMs: epochMsSchema.exactOptional(),
  fills: countSchema,
  maxFills: countSchema.exactOptional(),
};

/** Decodes a {@link SignerAuthorization} from JSON, and encodes it back with `z.encode`. */
export const signerAuthorizationSchema: z.ZodType<SignerAuthorization, SignerAuthorizationWire> =
  z.discriminatedUnion("kind", [
    z.strictObject({
      kind: z.literal("confirmation"),
      id: idSchema("cnf"),
      intent: idSchema("int"),
      termsHash: termsHashSchema,
      expiresAtMs: epochMsSchema,
    }),
    z.strictObject({ kind: z.literal("order"), id: idSchema("ord"), ...advanceShape }),
    z.strictObject({ kind: z.literal("webhookRule"), id: idSchema("whr"), ...advanceShape }),
    z.strictObject({
      kind: z.literal("approvalMode"),
      grant: autoModeGrantSchema,
      current: approvalModeNowSchema,
    }),
  ]);
