import { err, type Id, idSchema, ok, type Result } from "@binference/core";
import { type DailySummaryRecord, dailySummaryRecordSchema } from "@binference/engine/notices";
import type { EngineTables } from "../databases/engine-tables.js";
import { createSyncKysely } from "../dialect/sync-kysely.js";
import { decimalText } from "../rows/column-values.js";
import { resultSchema } from "../tasks/result-schema.js";
import { defineTask, type StoreTask } from "../tasks/store-task.js";

interface SummaryRow {
  readonly agent_id: string;
  readonly date: string;
  readonly at: number;
  readonly outcome: string;
  readonly live_usd_micros: string | null;
  readonly paper_usd_micros: string | null;
}

function recordOf(row: SummaryRow): DailySummaryRecord {
  return dailySummaryRecordSchema.parse({
    agentId: row.agent_id,
    date: row.date,
    atMs: row.at,
    outcome: row.outcome,
    ...(row.live_usd_micros === null ? {} : { liveUsdMicros: row.live_usd_micros }),
    ...(row.paper_usd_micros === null ? {} : { paperUsdMicros: row.paper_usd_micros }),
  });
}

/**
 * Stores an agent's summary of a date unless it has one of that date or a later one, which it
 * reads in the same transaction; an unknown agent breaks the foreign key and throws.
 */
export const claimDailySummaryTask: StoreTask<
  DailySummaryRecord,
  Result<DailySummaryRecord, "claimed">
> = defineTask({
  name: "daily_summaries.claim",
  access: "write",
  input: dailySummaryRecordSchema,
  output: resultSchema(dailySummaryRecordSchema, ["claimed"]),
  run(database, record) {
    const { kysely, execute, takeFirst } = createSyncKysely<EngineTables>(database);
    const taken = takeFirst(
      kysely
        .selectFrom("daily_summaries")
        .select("date")
        .where("agent_id", "=", record.agentId)
        .where("date", ">=", record.date),
    );
    if (taken !== undefined) {
      return err("claimed");
    }
    const { liveUsdMicros, paperUsdMicros } = record;
    execute(
      kysely.insertInto("daily_summaries").values({
        agent_id: record.agentId,
        date: record.date,
        at: record.atMs,
        outcome: record.outcome,
        live_usd_micros: liveUsdMicros === undefined ? null : decimalText(liveUsdMicros),
        paper_usd_micros: paperUsdMicros === undefined ? null : decimalText(paperUsdMicros),
      }),
    );
    return ok(record);
  },
});

/** An agent's summary of its latest date, if it has one. */
export const latestDailySummaryTask: StoreTask<
  Id<"agt">,
  DailySummaryRecord | undefined
> = defineTask({
  name: "daily_summaries.latest",
  access: "read",
  input: idSchema("agt"),
  output: dailySummaryRecordSchema.optional(),
  run(database, agent) {
    const { kysely, takeFirst } = createSyncKysely<EngineTables>(database);
    const row = takeFirst(
      kysely
        .selectFrom("daily_summaries")
        .selectAll()
        .where("agent_id", "=", agent)
        .orderBy("date", "desc")
        .limit(1),
    );
    return row === undefined ? undefined : recordOf(row);
  },
});
