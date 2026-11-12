// Test tasks that read and write the agent database's rows as no store port does, so a suite of
// the database's own rules runs through a host on SQLite and Postgres alike. Nothing in production
// uses this file.
import { type Id, idSchema } from "@binference/core";
import type { Compilable, Kysely } from "kysely";
import { z } from "zod";
import type { AgentRow, AgentRows } from "../contracts/agent-tables-contract.js";
import type { AgentTables } from "../databases/agent-tables.js";
import { createSyncKysely } from "../dialect/sync-kysely.js";
import type { StoreHost } from "../tasks/store-host.js";
import { defineTask, type StoreTask } from "../tasks/store-task.js";

/** The agent tables, with `counters`, which only the write-order triggers write. */
type RowTables = AgentTables & { counters: { name: string; last: number } };

/** Every table a reading holds: `notes_fts` is SQLite's index over `notes`, no rows of its own. */
type ReadTable = Exclude<keyof RowTables, "notes_fts">;

// Each table read whole, in the order of its key. The record names every table, so a table added
// to the agent database's types joins the reading.
const readings: Readonly<Record<ReadTable, (kysely: Kysely<RowTables>) => Compilable<object>>> = {
  meta: (kysely) => kysely.selectFrom("meta").selectAll().orderBy("key"),
  counters: (kysely) => kysely.selectFrom("counters").selectAll().orderBy("name"),
  sessions: (kysely) => kysely.selectFrom("sessions").selectAll().orderBy("id"),
  turns: (kysely) => kysely.selectFrom("turns").selectAll().orderBy("id"),
  transcript_events: (kysely) => kysely.selectFrom("transcript_events").selectAll().orderBy("id"),
  chat_queue: (kysely) => kysely.selectFrom("chat_queue").selectAll().orderBy("seq"),
  helpers: (kysely) => kysely.selectFrom("helpers").selectAll().orderBy("id"),
  goals: (kysely) => kysely.selectFrom("goals").selectAll().orderBy("session_id"),
  progress_notes: (kysely) => kysely.selectFrom("progress_notes").selectAll().orderBy("session_id"),
  notes: (kysely) => kysely.selectFrom("notes").selectAll().orderBy("id"),
};

const rowSchema: z.ZodType<AgentRow> = z.record(
  z.string(),
  z.union([z.string(), z.number(), z.null()]),
);

/** Reads every row of every agent table. */
export const readAgentRowsTask: StoreTask<null, AgentRows> = defineTask({
  name: "testing.read_agent_rows",
  access: "read",
  input: z.null(),
  output: z.record(z.string(), z.array(rowSchema)),
  run(database) {
    const { kysely, execute } = createSyncKysely<RowTables>(database);
    return Object.fromEntries(
      Object.entries(readings).map(([table, reading]) => [
        table,
        execute(reading(kysely)).rows.map((row) => rowSchema.parse(row)),
      ]),
    );
  },
});

/** Changes one transcript event's content in its row, which the transcript's trigger refuses. */
export const changeEventTask: StoreTask<number, null> = defineTask({
  name: "testing.change_event",
  access: "write",
  input: z.int().positive(),
  output: z.null(),
  run(database, id) {
    const { kysely, execute } = createSyncKysely<AgentTables>(database);
    execute(
      kysely.updateTable("transcript_events").set({ content: '"changed"' }).where("id", "=", id),
    );
    return null;
  },
});

/** Removes a session's events outside retention, which the transcript's trigger refuses. */
export const removeEventsTask: StoreTask<Id<"ses">, null> = defineTask({
  name: "testing.remove_events",
  access: "write",
  input: idSchema("ses"),
  output: z.null(),
  run(database, session) {
    const { kysely, execute } = createSyncKysely<AgentTables>(database);
    execute(kysely.deleteFrom("transcript_events").where("session_id", "=", session));
    return null;
  },
});

function call(): { readonly signal: AbortSignal } {
  return { signal: AbortSignal.timeout(30_000) };
}

/** Every row of every agent table, through `host`. */
export async function agentRowsOn(host: StoreHost): Promise<AgentRows> {
  return host.run(readAgentRowsTask, null, call());
}

/** Changes event `id`'s content through `host`. */
export async function changeEventOn(host: StoreHost, id: number): Promise<void> {
  await host.run(changeEventTask, id, call());
}

/** Removes the events of `session` through `host`, outside retention. */
export async function removeEventsOn(host: StoreHost, session: Id<"ses">): Promise<void> {
  await host.run(removeEventsTask, session, call());
}
