import { err, ok } from "@binference/core";
import { activeAgent } from "../operations/active-agent.js";
import type { EngineHandler } from "../operations/engine-call.js";
import type { ChatRelayOptions } from "./chat-relay-parts.js";
import { wakeWithMessage } from "./engine-message.js";

/** The operation the agent runtime tells the agent a helper's end with (decision 0403). */
export interface HelperEndHandlers {
  readonly "helper/ended": EngineHandler<"helper/ended">;
}

/** What a helper's end is stored and pushed through. */
export type HelperEndOptions = Pick<
  ChatRelayOptions,
  "agents" | "agentInbox" | "turns" | "ids" | "clock" | "publish" | "intentView"
>;

/**
 * Creates `helper/ended` (decision 0403): from the current runtime only, it wakes an active agent
 * with the runtime's words about its helper's end, as a message that starts the agent's next turn,
 * marked when a run of the helper read outside content. The engine keeps no helper: a full inbox
 * drops the words, and the agent reads the helper with `helper_list` and `helper_read`.
 */
export function createHelperEndHandlers(options: HelperEndOptions): HelperEndHandlers {
  return {
    "helper/ended": async (call) => {
      if (!options.turns.isRuntime(call.caller.credential)) {
        return err("auth.scope");
      }
      const { agent, text, surface, outsideContent } = call.args;
      const active = await activeAgent(options.agents, agent, call);
      if (!active.ok) {
        return active;
      }
      const message = { agent, text, surface, outsideContent };
      const woken = await wakeWithMessage(options, message, call.signal);
      return woken.ok || woken.error === "protocol.busy" ? ok({}) : woken;
    },
  };
}
