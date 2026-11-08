import { err, jsonValueSchema, ok } from "@binference/core";
import { operations } from "@binference/protocol";
import { z } from "zod";
import { activeAgent } from "../operations/active-agent.js";
import type { EngineHandler } from "../operations/engine-call.js";
import { chatTopic, type ChatRelayOptions } from "./chat-relay-parts.js";
import { wakeWithMessage } from "./engine-message.js";

/** The operations the agent runtime runs a chat's goal with (decision 0407). */
export interface GoalTurnHandlers {
  readonly "goal/continue": EngineHandler<"goal/continue">;
  readonly "goal/show": EngineHandler<"goal/show">;
}

/** What a goal turn is stored and pushed through. */
export type GoalTurnOptions = Pick<
  ChatRelayOptions,
  "agents" | "agentInbox" | "turns" | "ids" | "clock" | "publish" | "intentView"
>;

// `goal/continue`: the next goal turn of the chat the agent has open. A chat the owner cleared
// since gets none, and a full inbox drops it: the runtime asks again after the next turn.
function continueOf(options: GoalTurnOptions): EngineHandler<"goal/continue"> {
  return async (call) => {
    if (!options.turns.isRuntime(call.caller.credential)) {
      return err("auth.scope");
    }
    const { agent, session, text, surface, outsideContent } = call.args;
    const active = await activeAgent(options.agents, agent, call);
    if (!active.ok) {
      return active;
    }
    // A frozen agent works on no goal: its runtime pauses the goal (decision 0407).
    if (active.value.agent.frozenAtMs !== undefined) {
      return err("agent.frozen");
    }
    const open = await options.agentInbox.openSession(agent, call);
    if (open !== session) {
      return ok({});
    }
    const message = { agent, text, surface, outsideContent, goalTurn: true };
    const woken = await wakeWithMessage(options, message, call.signal);
    return woken.ok || woken.error === "protocol.busy" ? ok({}) : woken;
  };
}

// `goal/show`: the change pushed on the agent's chat topic as `chat/goal`, as its args carry it.
function showOf(options: GoalTurnOptions): EngineHandler<"goal/show"> {
  const schema = operations["goal/show"].args;
  return async (call) => {
    if (!options.turns.isRuntime(call.caller.credential)) {
      return err("auth.scope");
    }
    const data = jsonValueSchema.parse(z.encode(schema, call.args));
    options.publish({ topic: chatTopic(call.args.agent), kind: "chat/goal", data });
    return Promise.resolve(ok({}));
  };
}

/**
 * Creates `goal/continue` and `goal/show` (decision 0407), from the current runtime only:
 * the first wakes an active agent with binference's words for the next goal turn of its open chat,
 * as a message that starts a turn, marked when the turn before it was, and refuses a frozen agent
 * with `agent.frozen`; the second pushes a change
 * of a chat's goal or progress note to every surface as `chat/goal`. The engine keeps no goal:
 * the runtime owns it in `agent.sqlite`.
 */
export function createGoalTurnHandlers(options: GoalTurnOptions): GoalTurnHandlers {
  return { "goal/continue": continueOf(options), "goal/show": showOf(options) };
}
