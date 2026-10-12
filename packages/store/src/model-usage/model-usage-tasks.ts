import type { ModelCharge } from "@binference/engine";
import {
  type BudgetNoticeClaim,
  budgetNoticeClaimSchema,
  modelChargeSchema,
  type ModelSpend,
  modelSpendSchema,
  type SpendQuery,
  spendQuerySchema,
} from "@binference/engine/chat";
import { z } from "zod";
import type { EngineTables } from "../databases/engine-tables.js";
import { createSyncKysely } from "../dialect/sync-kysely.js";
import { decimalText, readDecimal } from "../rows/column-values.js";
import { defineTask, type StoreTask } from "../tasks/store-task.js";

/** Stores an attempt under its key: `true` when stored, `false` when the key was stored before. */
export const recordModelUsageTask: StoreTask<ModelCharge, boolean> = defineTask({
  name: "model_usage.record",
  access: "write",
  input: modelChargeSchema,
  output: z.boolean(),
  run(database, charge) {
    const { kysely, execute } = createSyncKysely<EngineTables>(database);
    const written = execute(
      kysely
        .insertInto("model_usage")
        .values({
          key: charge.key,
          agent_id: charge.agent,
          turn_id: charge.turn,
          model: charge.model,
          input_tokens: charge.inputTokens,
          output_tokens: charge.outputTokens,
          cached_tokens: charge.cachedTokens,
          usd_micros: decimalText(charge.usdMicros),
          at: charge.atMs,
        })
        .onConflict((conflict) => conflict.column("key").doNothing()),
    );
    return (written.numAffectedRows ?? 0n) > 0n;
  },
});

/** One row of the range, as the sum reads it. */
interface SpendRow {
  readonly agent_id: string;
  readonly model: string;
  readonly input_tokens: number;
  readonly output_tokens: number;
  readonly cached_tokens: number;
  readonly usd_micros: string;
}

// The rows of one agent and model, in the order the query gave them, summed. Amounts are summed
// as bigints, never by SQLite, whose sum of text turns it into a float.
function sumsOf(rows: readonly SpendRow[]): readonly ModelSpend[] {
  const sums: ModelSpend[] = [];
  for (const row of rows) {
    const last = sums.at(-1);
    const isSame = last !== undefined && last.agent === row.agent_id && last.model === row.model;
    const base = isSame
      ? last
      : modelSpendSchema.parse({
          agent: row.agent_id,
          model: row.model,
          inputTokens: 0,
          outputTokens: 0,
          cachedTokens: 0,
          usdMicros: 0n,
        });
    const sum = {
      ...base,
      inputTokens: base.inputTokens + row.input_tokens,
      outputTokens: base.outputTokens + row.output_tokens,
      cachedTokens: base.cachedTokens + row.cached_tokens,
      usdMicros: base.usdMicros + readDecimal(row.usd_micros),
    };
    sums.splice(isSame ? sums.length - 1 : sums.length, 1, sum);
  }
  return sums;
}

/** What each agent spent on each model in the range, by agent then model. */
export const modelSpendTask: StoreTask<SpendQuery, readonly ModelSpend[]> = defineTask({
  name: "model_usage.spent",
  access: "read",
  input: spendQuerySchema,
  output: z.array(modelSpendSchema).readonly(),
  run(database, query) {
    const { kysely, execute } = createSyncKysely<EngineTables>(database);
    const ranged = kysely
      .selectFrom("model_usage")
      .select(["agent_id", "model", "input_tokens", "output_tokens", "cached_tokens", "usd_micros"])
      .where("at", ">=", query.fromMs)
      .where("at", "<", query.toMs);
    const scoped = query.agent === undefined ? ranged : ranged.where("agent_id", "=", query.agent);
    return sumsOf(execute(scoped.orderBy("agent_id").orderBy("model")).rows);
  },
});

/** Claims an agent's budget notice of a day: `true` the first time, `false` after. */
export const claimBudgetNoticeTask: StoreTask<BudgetNoticeClaim, boolean> = defineTask({
  name: "model_usage.claim_budget_notice",
  access: "write",
  input: budgetNoticeClaimSchema,
  output: z.boolean(),
  run(database, claim) {
    const { kysely, execute } = createSyncKysely<EngineTables>(database);
    const written = execute(
      kysely
        .insertInto("budget_notices")
        .values({ agent_id: claim.agent, day_at: claim.dayAtMs, at: claim.atMs })
        .onConflict((conflict) => conflict.columns(["agent_id", "day_at"]).doNothing()),
    );
    return (written.numAffectedRows ?? 0n) > 0n;
  },
});
