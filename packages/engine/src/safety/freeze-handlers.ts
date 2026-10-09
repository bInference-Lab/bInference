import { ok } from "@binference/core";
import { authorOf } from "../audit/journal-config-change.js";
import type { EngineHandler } from "../operations/engine-call.js";
import { type FreezeAgentsOptions, freezeAgents } from "./freeze-agents.js";

/** The handler of `safety/freeze` (protocol spec, section 7.1). */
export interface FreezeHandlers {
  readonly "safety/freeze": EngineHandler<"safety/freeze">;
}

/**
 * Creates the `safety/freeze` handler: it freezes the agent the call names, or every agent when it
 * names none, at once and from any surface with `confirm` (ARCHITECTURE.md rule 11), and answers
 * when the freeze took effect. See {@link freezeAgents}.
 */
export function createFreezeHandlers(options: FreezeAgentsOptions): FreezeHandlers {
  return {
    async "safety/freeze"({ args, caller, signal }) {
      const { agent } = args;
      const request = { author: authorOf(caller), ...(agent === undefined ? {} : { agent }) };
      const frozen = await freezeAgents(options, request, signal);
      return frozen.ok ? ok({ frozenAt: frozen.value }) : frozen;
    },
  };
}
