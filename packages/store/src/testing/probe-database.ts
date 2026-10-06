import { BinferenceError } from "@binference/core";
import type { Generated } from "kysely";
import { z } from "zod";
import { workerUrl, type DatabaseDefinition } from "../databases/database-definition.js";
import { createSyncKysely } from "../dialect/sync-kysely.js";
import { migration as meta } from "../migrations/engine/0001_meta.js";
import type { Migration } from "../migrations/migration.js";
import { defineTask, type StoreTask } from "../tasks/store-task.js";

// A small database the store's own tests run on: numbered writes from several writers and one
// shared counter that each write reads and bumps.
interface ProbeTables {
  probe_writes: { id: Generated<number>; writer: number; seq: number };
  probe_counter: { id: number; value: number };
}

const probeTables: Migration = {
  name: "0002_probe_tables",
  up(database) {
    const { kysely, execute } = createSyncKysely<ProbeTables>(database);
    execute(
      kysely.schema
        .createTable("probe_writes")
        .addColumn("id", "integer", (column) => column.primaryKey())
        .addColumn("writer", "integer", (column) => column.notNull())
        .addColumn("seq", "integer", (column) => column.notNull())
        .addUniqueConstraint("probe_writes_writer_seq", ["writer", "seq"]),
    );
    execute(
      kysely.schema
        .createTable("probe_counter")
        .addColumn("id", "integer", (column) => column.primaryKey())
        .addColumn("value", "integer", (column) => column.notNull()),
    );
    execute(kysely.insertInto("probe_counter").values({ id: 1, value: 0 }));
  },
};

/** One numbered write from one writer. */
export interface ProbeWrite {
  readonly writer: number;
  readonly seq: number;
}

const probeWriteSchema: z.ZodType<ProbeWrite> = z.strictObject({
  writer: z.number().int().nonnegative(),
  seq: z.number().int().nonnegative(),
});

/** Bumps the shared counter and records the write in one transaction; returns the counter. */
export const recordWrite: StoreTask<ProbeWrite, number> = defineTask({
  name: "probe.record",
  access: "write",
  input: probeWriteSchema,
  output: z.number().int(),
  run(database, input) {
    const { kysely, execute, takeFirst } = createSyncKysely<ProbeTables>(database);
    const counter = takeFirst(
      kysely.selectFrom("probe_counter").select("value").where("id", "=", 1),
    );
    const value = (counter?.value ?? 0) + 1;
    execute(kysely.updateTable("probe_counter").set({ value }).where("id", "=", 1));
    execute(kysely.insertInto("probe_writes").values({ writer: input.writer, seq: input.seq }));
    return value;
  },
});

/** Records a write, then fails, so the whole transaction must roll back. */
export const failAfterWrite: StoreTask<ProbeWrite, number> = defineTask({
  name: "probe.fail_after_write",
  access: "write",
  input: probeWriteSchema,
  output: z.number().int(),
  run(database, input) {
    recordWrite.handle(database, input);
    throw new BinferenceError({
      code: "probe.failed",
      message: "The probe task fails on purpose.",
    });
  },
});

/** What the writers left, per writer. */
export interface ProbeSummary {
  readonly rows: number;
  readonly pairs: number;
  readonly counter: number;
  readonly writers: readonly { writer: number; count: number; firstSeq: number; lastSeq: number }[];
}

const count = z.number().int().nonnegative();

/** Counts the rows, the distinct (writer, seq) pairs and each writer's sequence range. */
export const summarize: StoreTask<null, ProbeSummary> = defineTask({
  name: "probe.summarize",
  access: "read",
  input: z.null(),
  output: z.strictObject({
    rows: count,
    pairs: count,
    counter: count,
    writers: z.array(z.strictObject({ writer: count, count, firstSeq: count, lastSeq: count })),
  }),
  run(database) {
    const { kysely, execute, takeFirst } = createSyncKysely<ProbeTables>(database);
    const writers = execute(
      kysely
        .selectFrom("probe_writes")
        .select((expression) => [
          "writer",
          expression.fn.countAll<number>().as("count"),
          expression.fn.min<number>("seq").as("firstSeq"),
          expression.fn.max<number>("seq").as("lastSeq"),
        ])
        .groupBy("writer")
        .orderBy("writer"),
    ).rows;
    const pairs = takeFirst(
      kysely
        .selectFrom(
          kysely.selectFrom("probe_writes").select(["writer", "seq"]).distinct().as("pair"),
        )
        .select((expression) => expression.fn.countAll<number>().as("count")),
    );
    const counter = takeFirst(
      kysely.selectFrom("probe_counter").select("value").where("id", "=", 1),
    );
    return {
      rows: writers.reduce((total, writer) => total + writer.count, 0),
      pairs: pairs?.count ?? 0,
      counter: counter?.value ?? 0,
      writers,
    };
  },
});

/** The probe database: the engine's `meta` migration, the probe tables and the probe tasks. */
export const probeDatabase: DatabaseDefinition = {
  name: "probe",
  synchronous: "normal",
  migrations: [meta, probeTables],
  tasks: [recordWrite, failAfterWrite, summarize],
};

/** The probe database's worker entry. */
export const probeWorker: URL = workerUrl(import.meta.url, "probe");
