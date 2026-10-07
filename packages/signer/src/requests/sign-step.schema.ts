import {
  type AccountRef,
  accountRefSchema,
  type ChainRef,
  chainRefSchema,
} from "@binference/chain";
import { decimalStringSchema } from "@binference/core";
import { z } from "zod";

/**
 * What one step of an intent's plan does, as the hard rules check the transaction against it:
 * a call to one of the venue's declared contracts with `nativeValue` sent along, an exact approval
 * of `amount` of `token` to `spender`, or a send of `amount` to `recipient`, of `token` when it is
 * set and of the native coin otherwise. Amounts are base units.
 */
export type StepAction =
  | { readonly kind: "call"; readonly nativeValue: bigint }
  | {
      readonly kind: "approve";
      readonly token: AccountRef;
      readonly spender: AccountRef;
      readonly amount: bigint;
    }
  | {
      readonly kind: "send";
      readonly recipient: AccountRef;
      readonly amount: bigint;
      readonly token?: AccountRef;
    };

/** A {@link StepAction} as JSON carries it: amounts as decimal strings. */
export type StepActionWire =
  | { readonly kind: "call"; readonly nativeValue: string }
  | {
      readonly kind: "approve";
      readonly token: string;
      readonly spender: string;
      readonly amount: string;
    }
  | {
      readonly kind: "send";
      readonly recipient: string;
      readonly amount: string;
      readonly token?: string;
    };

/** The call a speed-up repeats: the transaction signed before at the same nonce. */
export interface OriginalCall {
  readonly to: AccountRef;
  readonly value: bigint;
  /** The calldata as `0x` and hex; `0x` when there is none. */
  readonly data: string;
}

/**
 * A transaction that takes the nonce of one signed before (intent-states spec, section 6): a
 * speed-up repeats `original` at a higher fee; a cancel is a 0-value transfer to the wallet itself.
 */
export type StepReplacement =
  | { readonly kind: "speedUp"; readonly nonce: number; readonly original: OriginalCall }
  | { readonly kind: "cancel"; readonly nonce: number };

/** A {@link StepReplacement} as JSON carries it. */
export type StepReplacementWire =
  | {
      readonly kind: "speedUp";
      readonly nonce: number;
      readonly original: { readonly to: string; readonly value: string; readonly data: string };
    }
  | { readonly kind: "cancel"; readonly nonce: number };

/** The step of the plan a transaction belongs to. */
export interface SignStep {
  /** The step's place in the plan, from 0. */
  readonly index: number;
  /** The chain the step runs on. */
  readonly chain: ChainRef;
  readonly action: StepAction;
  /** Set when the transaction takes the nonce of one signed before. */
  readonly replaces?: StepReplacement;
}

/** A {@link SignStep} as JSON carries it. */
export interface SignStepWire {
  readonly index: number;
  readonly chain: string;
  readonly action: StepActionWire;
  readonly replaces?: StepReplacementWire;
}

const nonceSchema = z.int().nonnegative();
const calldataSchema = z.string().regex(/^0x(?:[0-9a-fA-F]{2})*$/);

const actionSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("call"), nativeValue: decimalStringSchema }),
  z.strictObject({
    kind: z.literal("approve"),
    token: accountRefSchema,
    spender: accountRefSchema,
    amount: decimalStringSchema,
  }),
  z.strictObject({
    kind: z.literal("send"),
    recipient: accountRefSchema,
    amount: decimalStringSchema,
    token: accountRefSchema.exactOptional(),
  }),
]);

const replacementSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("speedUp"),
    nonce: nonceSchema,
    original: z.strictObject({
      to: accountRefSchema,
      value: decimalStringSchema,
      data: calldataSchema,
    }),
  }),
  z.strictObject({ kind: z.literal("cancel"), nonce: nonceSchema }),
]);

/** Decodes a {@link SignStep} from JSON, and encodes it back with `z.encode`. */
export const signStepSchema: z.ZodType<SignStep, SignStepWire> = z.strictObject({
  index: z.int().nonnegative(),
  chain: chainRefSchema,
  action: actionSchema,
  replaces: replacementSchema.exactOptional(),
});
