import { type AlertCondition, alertConditionSchema, type AlertView } from "@binference/protocol";
import { z } from "zod";
import { agentToolTexts } from "./agent-tool-texts.js";
import { type AgentTool, defineTool } from "./define-tool.js";
import { isoTextOf, isoTimeSchema } from "./iso-time.schema.js";
import { answerOrRefusal, jsonOf } from "./tool-answer.js";
import type { AgentToolParts } from "./tool-client.js";

/** What `alert_create` takes: the condition, whether a fire wakes the agent, and its end. */
interface AlertArgs {
  readonly condition: AlertCondition;
  readonly wake?: boolean;
  readonly expiresAt?: number;
}

const alertArgs: z.ZodType<AlertArgs> = z.strictObject({
  condition: alertConditionSchema,
  wake: z.boolean().exactOptional(),
  expiresAt: isoTimeSchema.exactOptional(),
});

const unset = "not set, and nothing was stored:";

// The engine's refusals (decisions 0244 and 0247), each read as what to do next.
const refusals: Readonly<Record<string, string>> = {
  "alert.too_many": `${unset} this agent already has 50 active alerts, the most it may hold. Tell the owner; an alert they no longer need can be deleted first.`,
  "wallet.track_limit": `${unset} binference already watches 50 wallets across every agent, the most it tracks, and this alert would add another. Tell the owner.`,
  "market.no_data": `${unset} binference cannot price this token now, so a price alert on it would never fire. Check the token with token_info, or tell the owner.`,
  "protocol.bad_args": `${unset} the engine refused the terms: an asset or account binference does not know, a price or least value of zero, a launchpad it does not run, or an end that is not ahead. Correct the terms and set it again.`,
};

// The alert as the model reads it: its id, its condition as the engine stored it, whether it
// wakes the agent, and its end.
function setText(view: AlertView): string {
  const wakes =
    view.wake === true
      ? "Each fire tells the owner and starts a turn of yours, marked as outside content."
      : "Each fire tells the owner and does not wake you.";
  const end =
    view.expiresAt === undefined ? "It has no end." : `It ends at ${isoTextOf(view.expiresAt)}.`;
  const condition = jsonOf(alertConditionSchema, view.condition);
  return `Alert ${view.alert} is active, on ${condition}. ${wakes} ${end}`;
}

/**
 * `alert_create`, a control tool (runtime spec, section 5.1): sets an alert of its agent at once,
 * with no card and no transaction (decision 0244). A fire notifies the owner and, with `wake`,
 * starts a turn of the agent marked as outside content (decision 0245). It never commits the turn.
 */
export function alertCreateTool({ agent, client }: AgentToolParts): AgentTool {
  return defineTool({
    name: "alert_create",
    kind: "control",
    description: agentToolTexts.alert_create,
    args: alertArgs,
    run: async (args, { signal, idempotencyKey }) =>
      answerOrRefusal({ tool: "alert_create", refusals }, async () => {
        const set = { ...args, agent };
        const view = await client.call("alert/create", set, { signal, key: idempotencyKey });
        return { text: setText(view), isError: false };
      }),
  });
}
