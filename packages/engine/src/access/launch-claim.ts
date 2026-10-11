import type { Result } from "@binference/core";
import { z } from "zod";
import { epochMsSchema } from "../records/record-fields.js";
import { type Sha256Hex, sha256HexSchema } from "../records/sha256-hex.js";
import type { LaunchTicketRecord } from "./launch-ticket.js";

/**
 * A Telegram Mini App launch that passed every other check, claimed so it signs in once (decision
 * 0160). Only the SHA-256 of the launch's own `hash` field is kept, never the launch data.
 */
export interface LaunchClaim {
  /** The SHA-256 of the launch's `hash` field. */
  readonly launchHash: Sha256Hex;
  readonly atMs: number;
  /** A claim of the same hash at or after this time refuses the launch; older claims are deleted. */
  readonly sinceMs: number;
}

/** Parses a launch claim; `sinceMs` never lies after `atMs`. */
export const launchClaimSchema: z.ZodType<LaunchClaim> = z
  .strictObject({ launchHash: sha256HexSchema, atMs: epochMsSchema, sinceMs: epochMsSchema })
  .refine((claim) => claim.sinceMs <= claim.atMs, { message: "sinceMs lies after atMs." });

/** What a claim answers: the launch is new and now kept, or it was claimed since `sinceMs`. */
export type LaunchClaimOutcome = "claimed" | "seen";

/** Parses a launch claim's outcome. */
export const launchClaimOutcomeSchema: z.ZodType<LaunchClaimOutcome> = z.enum(["claimed", "seen"]);

/**
 * The access store's part that keeps the Mini App launches that signed in (decision 0160) and the
 * launch tickets `/console` made.
 */
export interface MiniAppLaunches {
  /**
   * Keeps a new launch ticket in one write: deletes the tickets expired by its `issuedAtMs`, keeps
   * it, then drops the oldest past `maxLaunchTickets`. A hash in use is `exists`.
   */
  addLaunchTicket(
    ticket: LaunchTicketRecord,
    options: { readonly signal: AbortSignal },
  ): Promise<Result<LaunchTicketRecord, "exists">>;
  /**
   * Claims a launch in one write: deletes the claims from before `sinceMs`, then answers `seen`
   * when the launch's hash is still kept, or keeps it and answers `claimed`.
   */
  claimLaunch(
    claim: LaunchClaim,
    options: { readonly signal: AbortSignal },
  ): Promise<LaunchClaimOutcome>;
}
