import { questionChoicesSchema, questionLimits } from "@binference/protocol";
import { z } from "zod";
import { agentToolTexts } from "./agent-tool-texts.js";
import { type AgentTool, defineTool } from "./define-tool.js";
import { answerOrRefusal } from "./tool-answer.js";
import type { AgentToolParts } from "./tool-client.js";

/** What `ask_owner` takes: the question, and the labels of its answer buttons. */
interface AskArgs {
  readonly text: string;
  readonly choices: readonly string[];
}

const askArgs: z.ZodType<AskArgs> = z.strictObject({
  text: z.string().trim().min(1).max(questionLimits.text),
  choices: questionChoicesSchema,
});

/** What the model reads once the question went out (runtime spec, section 6.4). */
export const askedText = "asked; the answer comes as the owner's next message";

const refusals: Readonly<Record<string, string>> = {
  "protocol.bad_args":
    "not asked: the engine refused the question, as this turn is no longer running. Nothing reached the owner.",
};

/**
 * `ask_owner`, a control tool (runtime spec, section 6.4): asks the owner one question with 2 to 4
 * answer buttons through `turn/ask`, in the turn it serves. Once asked, the turn ends after its
 * batch with no other model call, and the owner's answer comes as their next message, which starts
 * the next turn once. A proposal in the same batch wins over it (decision 0173).
 */
export function askOwnerTool({ agent, client, turn }: AgentToolParts): AgentTool {
  return defineTool({
    name: "ask_owner",
    kind: "control",
    asksOwner: true,
    description: agentToolTexts.ask_owner,
    args: askArgs,
    run: async ({ text, choices }, { signal, idempotencyKey }) =>
      answerOrRefusal({ tool: "ask_owner", refusals }, async () => {
        const asked = { agent, ...turn, text, choices };
        await client.call("turn/ask", asked, { signal, key: idempotencyKey });
        return { text: askedText, isError: false, endsTurn: true };
      }),
  });
}
