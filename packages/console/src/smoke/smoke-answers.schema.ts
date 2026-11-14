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

const alertSchema = z.object({ status: z.number(), fills: z.number() });

/** Reads the control listener's answer to `/alert`: the listener's answer and the rule's fills. */
export function readAlert(body: unknown): { readonly status: number; readonly fills: number } {
  return alertSchema.parse(body);
}

const statesSchema = z.object({ states: z.array(z.string()) });

/** Reads the control listener's answer to `/states`: the state of each of the agent's intents. */
export function readStates(body: unknown): readonly string[] {
  return statesSchema.parse(body).states;
}

const orderSchema = z.object({ order: z.string().check(z.regex(/^ord_/)) });

/** Reads the control listener's answer to `/order`: the paper order it made, whose card waits. */
export function readOrder(body: unknown): string {
  return orderSchema.parse(body).order;
}

const stateSchema = z.object({ state: z.string() });

/** Reads the control listener's answer to `/order?order=`: the order's state in the engine. */
export function readState(body: unknown): string {
  return stateSchema.parse(body).state;
}
