import type { AccountRef, ChainRef } from "@binference/chain";
import { type JsonValue, jsonValueSchema, type Secret } from "@binference/core";
import type { DayCapView } from "@binference/protocol";
import { z } from "zod";
import { epochMsSchema } from "../records/record-fields.js";

/** One wallet's ceiling and every account a send from the wallet may pay. */
export interface CeilingRecipients {
  /** The ceiling as custody names it: the wallet record's `policyId`. */
  readonly ceiling: string;
  readonly recipients: readonly AccountRef[];
}

/** Recipients to set now, with the owner key that owns every ceiling. */
export interface RecipientsRequest {
  /** The owner key code as the owner typed it; the editor uses it for this request only. */
  readonly ownerKey: Secret;
  readonly ceilings: readonly CeilingRecipients[];
}

/** A change of recipients to sign now and send later, from what each ceiling lists then. */
export interface SignRecipientsRequest {
  readonly ownerKey: Secret;
  readonly changes: readonly {
    readonly ceiling: string;
    readonly from: readonly AccountRef[];
    readonly to: readonly AccountRef[];
  }[];
  /** Epoch milliseconds after which custody refuses the change. */
  readonly untilMs: number;
}

/**
 * A change of ceilings signed ahead by the owner key, kept until it is sent. Only custody reads its
 * payload; it holds signatures over exact requests, never a key.
 */
export interface SignedCeilingChange {
  readonly untilMs: number;
  readonly payload: JsonValue;
}

/** Parses a change of ceilings signed ahead. */
export const signedCeilingChangeSchema: z.ZodType<SignedCeilingChange> = z.strictObject({
  untilMs: epochMsSchema,
  payload: jsonValueSchema,
});

/** What a ceiling lets a contract call do: reach its venues' registry contracts, under a cap. */
export interface CeilingCalls {
  /** The ceiling as custody names it: the wallet record's `policyId`. */
  readonly ceiling: string;
  /** The venues whose registry contracts a call may reach and approve, one or more. */
  readonly venues: readonly string[];
  /** The most native coin, in base units, one contract call may send. */
  readonly perTxNativeBase: bigint;
}

/** What contract calls may do under each ceiling, with the owner key that owns every ceiling. */
export interface CallsRequest {
  /** The owner key code as the owner typed it; the editor uses it for this request only. */
  readonly ownerKey: Secret;
  readonly ceilings: readonly CeilingCalls[];
}

/** A ceiling as custody holds it now. */
export interface CeilingRead {
  /** The chains it enables. */
  readonly chains: readonly ChainRef[];
  /** Each contract a call may reach, on each chain it enables. */
  readonly contracts: readonly AccountRef[];
  /** The most native coin, in base units, one contract call may send; 0 when none may. */
  readonly perTxNativeBase: bigint;
  /** Each account a send may pay, on each chain it enables. */
  readonly recipients: readonly AccountRef[];
  /**
   * Each 24-hour cap it names, as `ceiling/get` shows it: the native coin's first on each chain,
   * then each capped token's. Every ceiling of the install names the same sums (decision 0149).
   */
  readonly dayCaps: readonly DayCapView[];
  /** The ceiling as custody reports it, which a wallet's stored copy of its ceiling mirrors. */
  readonly policy: JsonValue;
}

/** Why the owner key's change of a ceiling was not made. */
export type CeilingRefusal =
  /** The code is no owner key, or not the key that owns the ceilings. */
  | "bad_owner_key"
  /** An account is malformed for the ceiling, or there are more than a ceiling lists. */
  | "bad_recipients"
  /** Custody holds no such ceiling, or it lists no recipients to change. */
  | "not_found";

/**
 * Why the owner key's change of what contract calls may do was not made: `bad_owner_key` and
 * `not_found` as for recipients, and `no_calls` for venues that give a chain a ceiling enables no
 * contract to call.
 */
export type CallsRefusal = Exclude<CeilingRefusal, "bad_recipients"> | "no_calls";

/**
 * Why a change signed ahead was not sent: a ceiling lists other recipients than it did when the
 * change was signed, the change expired, custody refused its signature, or a ceiling is gone.
 */
export type SignedChangeRefusal = "changed" | "expired" | "refused" | "not_found";
