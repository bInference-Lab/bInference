import { z } from "zod";
import { epochMsSchema } from "../records/record-fields.js";

/**
 * The disclaimer and privacy statement the owner accepted by typing its phrase (spec 4, section 9;
 * database spec, section 2.1): its version and when.
 */
export interface DisclaimerAcceptance {
  readonly version: number;
  readonly acceptedAtMs: number;
}

/** Parses a disclaimer acceptance. */
export const disclaimerAcceptanceSchema: z.ZodType<DisclaimerAcceptance> = z.strictObject({
  version: z.int().positive(),
  acceptedAtMs: epochMsSchema,
});

/** Where an install keeps the disclaimer its owner accepted, which `InstallFacts` reads back. */
export interface DisclaimerStore {
  /**
   * Keeps the version the owner accepted and when. An install that holds that version or a later
   * one keeps it as it is, so an acceptance never goes back to an older text.
   */
  acceptDisclaimer(
    acceptance: DisclaimerAcceptance,
    options: { readonly signal: AbortSignal },
  ): Promise<void>;
}
