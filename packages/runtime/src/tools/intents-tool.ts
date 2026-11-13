import { type JsonValue, jsonValueSchema } from "@binference/core";
import { operations } from "@binference/protocol";
import { z } from "zod";
import { agentToolTexts } from "./agent-tool-texts.js";
import { type AgentTool, defineTool } from "./define-tool.js";
import { isoTextOf, isoTimeSchema } from "./iso-time.schema.js";
import { answerOrFailure } from "./tool-answer.js";
import type { AgentToolParts } from "./tool-client.js";

/** What `intents` takes: the time to list from, and the cursor of the page after the first. */
interface IntentsArgs {
  /** Epoch ms, from an ISO 8601 date-time with its offset. */
  readonly since: number;
  readonly cursor?: string;
}

const intentsArgs: z.ZodType<IntentsArgs, { readonly since: string; readonly cursor?: string }> =
  z.strictObject({
    since: isoTimeSchema,
    cursor: z.string().min(1).max(512).exactOptional(),
  });

/** One intent as `intents` answers it: what was proposed, where it stands, and its card. */
interface ShownIntent {
  readonly intent: string;
  readonly kind: string;
  readonly state: string;
  readonly paper: boolean;
  readonly createdAt: string;
  readonly changedAt: string;
  readonly card?: { readonly card: string; readonly version: number; readonly expiresAt: string };
  /** The reason code an ended intent stored, such as `daily_cap`. */
  readonly reason?: string;
  /** The terms it was proposed with, in this agent's own words, as the engine's JSON gives them. */
  readonly request: JsonValue;
}

/** The parts of an intent's wire view `intents` shows. */
interface PickedIntent {
  readonly intent: string;
  readonly kind: string;
  readonly state: string;
  readonly paper: boolean;
  readonly createdAt: number;
  readonly changedAt: number;
  readonly card?: { readonly card: string; readonly version: number; readonly expiresAt: number };
  readonly outcome?: { readonly reason?: string };
  readonly request: JsonValue;
}

// Only what binference wrote or the agent proposed: no asset name, no validator name and no card
// line, so the answer holds no outside content.
const pickedSchema: z.ZodType<PickedIntent> = z.object({
  intent: z.string(),
  kind: z.string(),
  state: z.string(),
  paper: z.boolean(),
  createdAt: z.number(),
  changedAt: z.number(),
  card: z.object({ card: z.string(), version: z.number(), expiresAt: z.number() }).exactOptional(),
  outcome: z.object({ reason: z.string().exactOptional() }).exactOptional(),
  request: jsonValueSchema,
});

const pickedPageSchema = z.object({
  items: z.array(pickedSchema),
  next: z.string().exactOptional(),
});

function shownOf(picked: PickedIntent): ShownIntent {
  const { card, outcome } = picked;
  return {
    intent: picked.intent,
    kind: picked.kind,
    state: picked.state,
    paper: picked.paper,
    createdAt: isoTextOf(picked.createdAt),
    changedAt: isoTextOf(picked.changedAt),
    ...(card === undefined
      ? {}
      : { card: { card: card.card, version: card.version, expiresAt: isoTextOf(card.expiresAt) } }),
    ...(outcome?.reason === undefined ? {} : { reason: outcome.reason }),
    request: picked.request,
  };
}

const pageSize = 50;

/**
 * `intents`, a read tool (runtime spec, section 5.1): this agent's intents changed since a time
 * through `intent/list`, the least recently changed first, a page at a time, each with its kind,
 * state, times, card and the terms it was proposed with. It is how the agent learns whether a
 * proposal whose outcome is unknown took effect before it proposes anything again (decision
 * 0437). Everything it shows binference wrote or the agent proposed, so it marks nothing.
 */
export function intentsTool({ agent, client }: AgentToolParts): AgentTool {
  return defineTool<IntentsArgs>({
    name: "intents",
    kind: "read",
    parallel: true,
    addressSource: "engine",
    description: agentToolTexts.intents,
    args: intentsArgs,
    run: async ({ since, cursor }, { signal }) =>
      answerOrFailure("intents", async () => {
        const args = { agent, changedSince: since, limit: pageSize };
        const asked = cursor === undefined ? args : { ...args, cursor };
        const page = await client.call("intent/list", asked, { signal });
        // The engine's JSON as the wire carries it, amounts as decimal text, then the parts shown.
        const wire = pickedPageSchema.parse(operations["intent/list"].result.encode(page));
        const items = wire.items.map(shownOf);
        const shown = wire.next === undefined ? { items } : { items, next: wire.next };
        return { text: JSON.stringify(shown), isError: false };
      }),
  });
}
