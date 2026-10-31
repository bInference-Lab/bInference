import type { AccountRef, ChainRef, WalletRole } from "@binference/chain";
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
  /**
   * The size every 24-hour cap the ceiling names becomes, in micro-dollars at each asset's floor
   * price; the caps stay as they are when absent. The sums they cap stay (decision 0151).
   */
  readonly dayCapUsdMicros?: bigint;
  /**
   * The role of the wallet whose ceiling it is: a launch wallet's also allows the calls the
   * install's launchpads declare on each launch's own contracts (decision 0217), written again with
   * the rest. Absent, a main wallet's.
   */
  readonly role?: WalletRole;
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
  /**
   * Each contract its rules name, on each chain it enables: one a call may reach, a spender a
   * token may approve, or one a bridge deposit may reach. A venue is in the ceiling when one of
   * its registry contracts is here.
   */
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
  /**
   * The functions a launch wallet's ceiling lets a call reach on any contract, such as a launch's
   * `buy` and `approve` (decision 0218); none for an agent wallet.
   */
  readonly launchCalls: readonly string[];
  /**
   * The functions its call and bridge rules let a call reach on the contracts they name, each
   * once: a change of them, such as a launchpad's new create call, is a change of the venues'
   * calls (decision 0271).
   */
  readonly functions: readonly string[];
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
  | "not_found"
  /** A ceiling, once changed, would be past what custody keeps; nothing was changed. */
  | "too_large";

/**
 * Why the owner key's change of what contract calls may do was not made: `bad_owner_key`,
 * `not_found` and `too_large` as for recipients, `no_calls` for venues that give a chain a ceiling
 * enables no contract to call, `bad_bridge` for a bridge deposit a venue declares that no ceiling
 * can hold, `uncapped_token` for a bridge route whose token has no 24-hour cap custody could
 * make (decision 0305), and `no_bridge_calls` for a bridge wallet's ceiling no venue the install
 * runs gives a deposit, which would leave it allowing nothing (decision 0307). Nothing was changed.
 */
export type CallsRefusal =
  | Exclude<CeilingRefusal, "bad_recipients">
  | "no_calls"
  | "no_bridge_calls"
  | "bad_bridge"
  | "uncapped_token";

/**
 * Why a change signed ahead was not sent: a ceiling lists other recipients than it did when the
 * change was signed, the change expired, custody refused its signature, or a ceiling is gone.
 */
export type SignedChangeRefusal = "changed" | "expired" | "refused" | "not_found";
