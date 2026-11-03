import { type Id, idSchema } from "@binference/core";
import { z } from "zod";
import {
  type ApprovalModeNow,
  approvalModeNowSchema,
  type ApprovalModeNowWire,
  type AutoModeGrant,
  autoModeGrantSchema,
  type AutoModeGrantWire,
} from "./auto-mode-grant.js";
import {
  type FillGrant,
  type FillGrantWire,
  fillGrantSchema,
  type FillSourceNow,
  type FillSourceNowWire,
  fillSourceNowSchema,
} from "./fill-grant.js";

/**
 * What approved the intent a transaction belongs to, with the facts the hard rules check (keys
 * spec, section 5.2, rule 5): the owner's confirmation of its card; an auto order or a webhook
 * rule the owner confirmed in advance, by the fill grant for the intent and its source as it
 * stands, never the rule's card alone (decision 0338); or the agent's auto mode: its grant for the
 * intent and the mode as it stands. The terms hash is that of what the owner confirmed, of the
 * fill its grant binds, or of the intent that passed the auto test.
 */
export type SignAuthorization =
  | {
      readonly kind: "confirmation";
      readonly id: Id<"cnf">;
      readonly intent: Id<"int">;
      readonly termsHash: string;
      /** After this the confirmation authorizes no signature. */
      readonly expiresAtMs: number;
    }
  | { readonly kind: "fill"; readonly grant: FillGrant; readonly current: FillSourceNow }
  | {
      readonly kind: "approvalMode";
      readonly grant: AutoModeGrant;
      readonly current: ApprovalModeNow;
    };

/** A {@link SignAuthorization} as JSON carries it: ids as text, amounts as decimal strings. */
export type SignAuthorizationWire =
  | {
      readonly kind: "confirmation";
      readonly id: string;
      readonly intent: string;
      readonly termsHash: string;
      readonly expiresAtMs: number;
    }
  | { readonly kind: "fill"; readonly grant: FillGrantWire; readonly current: FillSourceNowWire }
  | {
      readonly kind: "approvalMode";
      readonly grant: AutoModeGrantWire;
      readonly current: ApprovalModeNowWire;
    };

/** A SHA-256 as 64 lowercase hex characters, as the store keeps a terms hash. */
export const termsHashSchema: z.ZodType<string, string> = z.string().regex(/^[0-9a-f]{64}$/);

const epochMsSchema = z.int().nonnegative();

/** Decodes a {@link SignAuthorization} from JSON, and encodes it back with `z.encode`. */
export const signAuthorizationSchema: z.ZodType<SignAuthorization, SignAuthorizationWire> =
  z.discriminatedUnion("kind", [
    z.strictObject({
      kind: z.literal("confirmation"),
      id: idSchema("cnf"),
      intent: idSchema("int"),
      termsHash: termsHashSchema,
      expiresAtMs: epochMsSchema,
    }),
    z.strictObject({
      kind: z.literal("fill"),
      grant: fillGrantSchema,
      current: fillSourceNowSchema,
    }),
    z.strictObject({
      kind: z.literal("approvalMode"),
      grant: autoModeGrantSchema,
      current: approvalModeNowSchema,
    }),
  ]);
