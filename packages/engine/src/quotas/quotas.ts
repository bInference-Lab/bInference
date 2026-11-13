import { z } from "zod";

/**
 * The most one install may hold, and how fast its agents may work, as its quota source answers
 * now (decision 0431). A field left out holds no quota, and nothing counts it.
 */
export interface Quotas {
  /** The install's agents not archived. */
  readonly agents?: number;
  /** The install's live agents not archived. */
  readonly liveAgents?: number;
  /** One agent's auto orders awaiting their card, active or paused. */
  readonly openOrders?: number;
  /** The install's plugins turned on. */
  readonly enabledPlugins?: number;
  /** The listed MCP servers on for one agent. */
  readonly listedMcpServers?: number;
  /** One agent's proposals in the last 60 seconds. */
  readonly proposalsPerMinute?: number;
  /** One agent's turns and helper runs that called a model in the last 60 seconds. */
  readonly turnsPerMinute?: number;
}

const most = z.int().nonnegative().exactOptional();

/** Parses an install's quotas: each a whole number of at least 0. */
export const quotasSchema: z.ZodType<Quotas> = z.strictObject({
  agents: most,
  liveAgents: most,
  openOrders: most,
  enabledPlugins: most,
  listedMcpServers: most,
  proposalsPerMinute: most,
  turnsPerMinute: most,
});

/**
 * A store call of a write that adds what a quota counts. `quota` is the most the write may leave;
 * with none, the write counts nothing.
 */
export interface QuotaCall {
  readonly signal: AbortSignal;
  readonly quota?: number;
}

/** The call of a write with its quota, or with none when no quota holds. */
export function withQuota(call: { readonly signal: AbortSignal }, quota?: number): QuotaCall {
  return quota === undefined ? { signal: call.signal } : { signal: call.signal, quota };
}
