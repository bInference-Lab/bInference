import * as z from "zod/mini";

/** The smoke engine's control answers: a pairing link, a proposed intent, the intents' states. */
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

const statesSchema = z.object({ states: z.array(z.string()) });

/** Reads the control listener's answer to `/states`: the state of each of the agent's intents. */
export function readStates(body: unknown): readonly string[] {
  return statesSchema.parse(body).states;
}
