import { type Id, idSchema } from "@binference/core";
import { z } from "zod";
import { epochMsSchema } from "../records/record-fields.js";

/**
 * The cost of one attempt of a model call to charge to an agent, as the agent runtime records it
 * (runtime spec, section 8.3): the model called, its tokens and its cost. `key` names the attempt,
 * `<turn>.usage.<n>`, so an attempt sent twice is charged once.
 */
export interface ModelCharge {
  readonly agent: Id<"agt">;
  readonly turn: Id<"trn">;
  readonly key: string;
  readonly model: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cachedTokens: number;
  /** The call's cost in micro-dollars, 0 or more. */
  readonly usdMicros: bigint;
  readonly atMs: number;
}

const tokens = z.int().nonnegative();

/** Parses a model charge. */
export const modelChargeSchema: z.ZodType<ModelCharge> = z.strictObject({
  agent: idSchema("agt"),
  turn: idSchema("trn"),
  key: z.string().min(1).max(64),
  model: z.string().min(1).max(128),
  inputTokens: tokens,
  outputTokens: tokens,
  cachedTokens: tokens,
  usdMicros: z.bigint().nonnegative(),
  atMs: epochMsSchema,
});

/** One agent's spend on one model over a time range: its tokens and its cost. */
export interface ModelSpend {
  readonly agent: Id<"agt">;
  readonly model: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cachedTokens: number;
  readonly usdMicros: bigint;
}

/** Parses a model spend. */
export const modelSpendSchema: z.ZodType<ModelSpend> = z.strictObject({
  agent: idSchema("agt"),
  model: z.string().min(1).max(128),
  inputTokens: tokens,
  outputTokens: tokens,
  cachedTokens: tokens,
  usdMicros: z.bigint().nonnegative(),
});

/** Which spend to sum: from `fromMs` up to, not including, `toMs`, of one agent or of every one. */
export interface SpendQuery {
  readonly agent?: Id<"agt">;
  readonly fromMs: number;
  readonly toMs: number;
}

/** Parses a spend query. */
export const spendQuerySchema: z.ZodType<SpendQuery> = z.strictObject({
  agent: idSchema("agt").exactOptional(),
  fromMs: epochMsSchema,
  toMs: epochMsSchema,
});

/** The budget notice of one agent's day: the day's start in the owner's timezone. */
export interface BudgetNoticeClaim {
  readonly agent: Id<"agt">;
  readonly dayAtMs: number;
  readonly atMs: number;
}

/** Parses a budget notice claim. */
export const budgetNoticeClaimSchema: z.ZodType<BudgetNoticeClaim> = z.strictObject({
  agent: idSchema("agt"),
  dayAtMs: epochMsSchema,
  atMs: epochMsSchema,
});
