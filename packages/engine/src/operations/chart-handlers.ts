import { err, jsonValueSchema, ok } from "@binference/core";
import { chatTopic } from "../chat/chat-relay-parts.js";
import type { AgentStore } from "../ports.js";
import type { PublishPush } from "../pushes/engine-push.js";
import type { EngineHandler } from "./engine-call.js";

/** The handler of `turn/chart` (protocol spec, section 7.7). */
export interface ChartHandlers {
  readonly "turn/chart": EngineHandler<"turn/chart">;
}

/**
 * Creates `turn/chart` (decision 0387): the agent shows the owner a chart in the chat of a turn.
 * The engine pushes the chart, already checked against the protocol's limits, on the agent's chat
 * topic as `chat/chart`; a surface that draws charts draws it, any other shows its text. An
 * unknown agent is `agent.not_found`.
 */
export function createChartHandlers(options: {
  readonly agents: AgentStore;
  readonly publish: PublishPush;
}): ChartHandlers {
  return {
    async "turn/chart"(call) {
      const { agent, turn, chart } = call.args;
      if ((await options.agents.get(agent, call)) === undefined) {
        return err("agent.not_found");
      }
      const data = jsonValueSchema.parse({ agent, turn, chart });
      options.publish({ topic: chatTopic(agent), kind: "chat/chart", data });
      return ok({ chart });
    },
  };
}
