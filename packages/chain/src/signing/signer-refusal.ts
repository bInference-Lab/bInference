import { z } from "zod";

/**
 * Why the signer refused a request (keys spec, section 5): `unknown_request` for a message it
 * cannot read or a kind it does not know, `malformed` for a known kind that breaks its schema or a
 * Privy body it cannot read, and `rule_<n>` for the first hard rule of section 5.2 the request
 * breaks.
 */
export type SignerRefusal =
  | "unknown_request"
  | "malformed"
  | "rule_1"
  | "rule_2"
  | "rule_3"
  | "rule_4"
  | "rule_5"
  | "rule_6";

/** Parses a {@link SignerRefusal}. */
export const signerRefusalSchema: z.ZodType<SignerRefusal, SignerRefusal> = z.enum([
  "unknown_request",
  "malformed",
  "rule_1",
  "rule_2",
  "rule_3",
  "rule_4",
  "rule_5",
  "rule_6",
]);
