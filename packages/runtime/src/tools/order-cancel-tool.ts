import { operations } from "@binference/protocol";
import { agentToolTexts } from "./agent-tool-texts.js";
import { type AgentTool, defineTool } from "./define-tool.js";
import { answerOrFailure } from "./tool-answer.js";
import type { AgentToolParts } from "./tool-client.js";

/**
 * `order_cancel`, a control tool that brakes (runtime spec, section 5.1): it cancels one of its
 * agent's auto orders at once, with no card, so it runs in a committed turn's batch too. An order
 * of another agent is answered as one that does not exist.
 */
export function orderCancelTool({ agent, client }: AgentToolParts): AgentTool {
  return defineTool({
    name: "order_cancel",
    kind: "control",
    description: agentToolTexts.order_cancel,
    args: operations["order/cancel"].args,
    run: async (args, { signal, idempotencyKey }) =>
      answerOrFailure("order_cancel", async () => {
        const found = await client.call("order/get", args, { signal });
        if (found.agent !== agent) {
          return { text: `This agent has no auto order ${args.order}.`, isError: true };
        }
        const order = await client.call("order/cancel", args, { signal, key: idempotencyKey });
        return { text: `Auto order ${order.order} is ${order.state}.`, isError: false };
      }),
  });
}
