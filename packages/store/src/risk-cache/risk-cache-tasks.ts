import { type TokenRiskReport, tokenRiskReportSchema } from "@binference/chain";
import { jsonValueSchema } from "@binference/core";
import {
  type CachedRiskReport,
  cachedRiskReportSchema,
  type RiskCacheKey,
  riskCacheKeySchema,
} from "@binference/engine/risk";
import { z } from "zod";
import type { EngineTables } from "../databases/engine-tables.js";
import { createSyncKysely } from "../dialect/sync-kysely.js";
import { jsonText, readJson } from "../rows/column-values.js";
import { defineTask, type StoreTask, type TaskRunner } from "../tasks/store-task.js";

function reportText(report: TokenRiskReport): string {
  return jsonText(jsonValueSchema.parse(z.encode(tokenRiskReportSchema, report)));
}

/** Reads one source's stored report for one token. */
export const readRiskTask: StoreTask<RiskCacheKey, CachedRiskReport | undefined> = defineTask({
  name: "risk_cache.read",
  access: "read",
  input: riskCacheKeySchema,
  output: cachedRiskReportSchema.optional(),
  run(database, key) {
    const { kysely, takeFirst } = createSyncKysely<EngineTables>(database);
    const row = takeFirst(
      kysely
        .selectFrom("risk_cache")
        .selectAll()
        .where("asset", "=", key.asset)
        .where("source", "=", key.source),
    );
    return row === undefined
      ? undefined
      : {
          ...key,
          report: tokenRiskReportSchema.parse(readJson(row.result)),
          fetchedAtMs: row.fetched_at,
        };
  },
});

/** Stores a source's report for a token, in place of the one before. */
export const writeRiskTask: StoreTask<CachedRiskReport, null> = defineTask({
  name: "risk_cache.write",
  access: "write",
  input: cachedRiskReportSchema,
  output: z.null(),
  run(database, entry) {
    const { kysely, execute } = createSyncKysely<EngineTables>(database);
    const columns = { result: reportText(entry.report), fetched_at: entry.fetchedAtMs };
    execute(
      kysely
        .insertInto("risk_cache")
        .values({ asset: entry.asset, source: entry.source, ...columns })
        .onConflict((conflict) => conflict.columns(["asset", "source"]).doUpdateSet(columns)),
    );
    return null;
  },
});

/** Every task of the SQLite risk cache. */
export const riskCacheTasks: readonly TaskRunner[] = [readRiskTask, writeRiskTask];
