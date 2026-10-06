import { z } from "zod";
import { type ProtocolId, protocolIdSchema } from "../ids/id-prefixes.js";

/** The args of an operation on one agent. */
export interface AgentArgs {
  readonly agent: ProtocolId<"agent">;
}

/** Parses the args of an operation on one agent. Unknown fields are refused. */
export const agentArgsSchema: z.ZodType<AgentArgs> = z.strictObject({
  agent: protocolIdSchema("agent"),
});
