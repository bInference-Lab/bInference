import { z } from "zod";
import { type ProtocolId, protocolIdSchema } from "../ids/id-prefixes.js";
import { type Locale, localeSchema } from "../locale.js";
import { epochMsSchema } from "../values/epoch-ms.schema.js";
import { type WalletView, walletViewSchema } from "./wallet-view.schema.js";

/** Whether an agent trades on paper or with real money. */
export type AgentMode = "paper" | "live";

/**
 * An agent: its name, mode, language, whether it is frozen or archived, and, in `agent/list`, its
 * default wallet.
 */
export interface AgentView {
  readonly agent: ProtocolId<"agent">;
  readonly name: string;
  readonly mode: AgentMode;
  readonly locale: Locale;
  readonly frozenAt?: number;
  readonly archivedAt?: number;
  readonly createdAt: number;
  readonly changedAt: number;
  /**
   * The wallet a proposal uses when it names none: the agent's oldest wallet not archived. Only
   * `agent/list` sets it; absent when the agent has none or custody holds it on no chain.
   */
  readonly defaultWallet?: WalletView;
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
  defaultWallet: walletViewSchema.exactOptional(),
});
