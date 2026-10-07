import { decimalStringSchema, type Id, idSchema } from "@binference/core";
import { z } from "zod";

/**
 * The auto grant: what authorizes the steps of an intent the agent's auto mode confirmed, as a
 * confirmation record does for a tapped intent (intent-states spec, section 5). The engine's
 * approval modes make it when the intent passes the auto test; the fields are theirs.
 */
export interface AutoModeGrant {
  readonly approvalMode: "auto";
  readonly agent: Id<"agt">;
  readonly intent: Id<"int">;
  /** The intent's kind: a trade, or a lend or stake move inside the agent's own positions. */
  readonly kind: "swap" | "buy" | "sell" | "lend" | "stake";
  /** The approval mode's version when the intent passed the auto test. */
  readonly modeVersion: number;
  /** The terms hash of the intent the auto test passed. */
  readonly termsHash: string;
  readonly grantedAtMs: number;
  /** After this the grant authorizes no signature. */
  readonly expiresAtMs: number;
  /** The chain's network fee cap: the most fee per gas, in base units of the native coin. */
  readonly networkFeeCapNativeBase: bigint;
}

/** An {@link AutoModeGrant} as JSON carries it: ids as text, the cap as a decimal string. */
export interface AutoModeGrantWire extends Omit<
  AutoModeGrant,
  "agent" | "intent" | "networkFeeCapNativeBase"
> {
  readonly agent: string;
  readonly intent: string;
  readonly networkFeeCapNativeBase: string;
}

/** The agent's approval mode as the engine read it right before asking for the signature. */
export interface ApprovalModeNow {
  readonly agent: Id<"agt">;
  readonly mode: "manual" | "auto";
  /** The version of the agent's approval-mode record; every change raises it. */
  readonly version: number;
}

/** An {@link ApprovalModeNow} as JSON carries it. */
export interface ApprovalModeNowWire extends Omit<ApprovalModeNow, "agent"> {
  readonly agent: string;
}

const countSchema = z.int().nonnegative();

/** Decodes an {@link AutoModeGrant} from JSON, and encodes it back with `z.encode`. */
export const autoModeGrantSchema: z.ZodType<AutoModeGrant, AutoModeGrantWire> = z.strictObject({
  approvalMode: z.literal("auto"),
  agent: idSchema("agt"),
  intent: idSchema("int"),
  kind: z.enum(["swap", "buy", "sell", "lend", "stake"]),
  modeVersion: countSchema,
  termsHash: z.string().regex(/^[0-9a-f]{64}$/),
  grantedAtMs: countSchema,
  expiresAtMs: countSchema,
  networkFeeCapNativeBase: decimalStringSchema,
});

/** Decodes an {@link ApprovalModeNow} from JSON. */
export const approvalModeNowSchema: z.ZodType<ApprovalModeNow, ApprovalModeNowWire> =
  z.strictObject({
    agent: idSchema("agt"),
    mode: z.enum(["manual", "auto"]),
    version: countSchema,
  });
