import * as z from "zod/mini";

/** The smoke engine's control answers: a pairing link, a proposed intent, an intent's state. */
const pairedSchema = z.object({ link: z.url() });
const proposedSchema = z.object({ intent: z.string().check(z.regex(/^int_/)) });

/** Reads the control listener's answer to `/pair`: the console's pairing link. */
export function readPairing(body: unknown): string {
  return pairedSchema.parse(body).link;
}

/** Reads the control listener's answer to `/propose`: the intent whose card opened. */
export function readProposal(body: unknown): string {
  return proposedSchema.parse(body).intent;
}
