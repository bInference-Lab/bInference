import { z } from "zod";
import { type ProtocolId, protocolIdSchema } from "../ids/id-prefixes.js";
import { type Locale, localeSchema } from "../locale.js";
import { epochMsSchema } from "../values/epoch-ms.schema.js";

/** Whether an agent trades on paper or with real money. */
export type AgentMode = "paper" | "live";

/** An agent: its name, mode, language and whether it is frozen or archived. */
export interface AgentView {
  readonly agent: ProtocolId<"agent">;
  readonly name: string;
  readonly mode: AgentMode;
  readonly locale: Locale;
  readonly frozenAt?: number;
  readonly archivedAt?: number;
  readonly createdAt: number;
  readonly changedAt: number;
}

/** Parses an agent mode. */
export const agentModeSchema: z.ZodType<AgentMode, string> = z.enum(["paper", "live"]);

/** Parses an agent view. */
export const agentViewSchema: z.ZodType<AgentView> = z.object({
  agent: protocolIdSchema("agent"),
  name: z.string(),
  mode: agentModeSchema,
  locale: localeSchema,
  frozenAt: epochMsSchema.exactOptional(),
  archivedAt: epochMsSchema.exactOptional(),
  createdAt: epochMsSchema,
  changedAt: epochMsSchema,
});
