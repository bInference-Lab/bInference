import {
  type AllowedCommandRecord,
  allowedCommandRecordSchema,
  type ShellWatchRecord,
  shellWatchRecordSchema,
} from "@binference/engine/shell";
import { z } from "zod";
import type { EngineTables } from "../databases/engine-tables.js";
import { createSyncKysely } from "../dialect/sync-kysely.js";
import { defineTask, type StoreTask } from "../tasks/store-task.js";

const argsSchema = z.array(z.string()).readonly();
const recordsSchema = z.array(allowedCommandRecordSchema).readonly();
const watchesSchema = z.array(shellWatchRecordSchema).readonly();

function recordOf(row: {
  readonly id: string;
  readonly text: string;
  readonly program: string;
  readonly args: string;
  readonly folder: string;
  readonly allowed_at: number;
}): AllowedCommandRecord {
  return allowedCommandRecordSchema.parse({
    id: row.id,
    text: row.text,
    program: row.program,
    args: argsSchema.parse(JSON.parse(row.args)),
    folder: row.folder,
    allowedAtMs: row.allowed_at,
  });
}

const allowedColumns = ["id", "text", "program", "args", "folder", "allowed_at"] as const;

/** Every allowed command, in the order they were kept. */
export const listAllowedTask: StoreTask<null, readonly AllowedCommandRecord[]> = defineTask({
  name: "shell.allowed",
  access: "read",
  input: z.null(),
  output: recordsSchema,
  run(database) {
    const { kysely, execute } = createSyncKysely<EngineTables>(database);
    const query = kysely.selectFrom("shell_allowed").select(allowedColumns).orderBy("seq");
    return execute(query).rows.map(recordOf);
  },
});

/** Keeps each command no row holds yet with its program, arguments and folder; answers those. */
export const allowTask: StoreTask<
  readonly AllowedCommandRecord[],
  readonly AllowedCommandRecord[]
> = defineTask({
  name: "shell.allow",
  access: "write",
  input: recordsSchema,
  output: recordsSchema,
  run(database, commands) {
    const { kysely, execute } = createSyncKysely<EngineTables>(database);
    return commands.filter((command) => {
      const row = {
        id: command.id,
        text: command.text,
        program: command.program,
        args: JSON.stringify(command.args),
        folder: command.folder,
        allowed_at: command.allowedAtMs,
      };
      const inserted = execute(
        kysely
          .insertInto("shell_allowed")
          .values(row)
          .onConflict((conflict) => conflict.columns(["program", "args", "folder"]).doNothing()),
      );
      return inserted.numAffectedRows === 1n;
    });
  },
});

/** Removes an allowed command and answers it, or null when none has the id. */
export const disallowTask: StoreTask<string, AllowedCommandRecord | null> = defineTask({
  name: "shell.disallow",
  access: "write",
  input: z.string(),
  output: allowedCommandRecordSchema.nullable(),
  run(database, id) {
    const { kysely, execute, takeFirst } = createSyncKysely<EngineTables>(database);
    const row = takeFirst(
      kysely.selectFrom("shell_allowed").select(allowedColumns).where("id", "=", id),
    );
    if (row === undefined) {
      return null;
    }
    execute(kysely.deleteFrom("shell_allowed").where("id", "=", id));
    return recordOf(row);
  },
});

/** Keeps a watched job once. */
export const watchTask: StoreTask<ShellWatchRecord, null> = defineTask({
  name: "shell.watch",
  access: "write",
  input: shellWatchRecordSchema,
  output: z.null(),
  run(database, watch) {
    const { kysely, execute } = createSyncKysely<EngineTables>(database);
    const row = {
      job: watch.job,
      agent_id: watch.agentId,
      command: watch.command,
      folder: watch.folder,
      started_at: watch.startedAtMs,
      surface: watch.surface,
    };
    execute(
      kysely
        .insertInto("shell_watches")
        .values(row)
        .onConflict((conflict) => conflict.column("job").doNothing()),
    );
    return null;
  },
});

/** Drops a watched job; true only for the call that dropped it. */
export const unwatchTask: StoreTask<string, boolean> = defineTask({
  name: "shell.unwatch",
  access: "write",
  input: z.string(),
  output: z.boolean(),
  run(database, job) {
    const { kysely, execute } = createSyncKysely<EngineTables>(database);
    const result = execute(kysely.deleteFrom("shell_watches").where("job", "=", job));
    return Number(result.numAffectedRows ?? 0n) > 0;
  },
});

/** Every watched job, oldest first. */
export const listWatchesTask: StoreTask<null, readonly ShellWatchRecord[]> = defineTask({
  name: "shell.watched",
  access: "read",
  input: z.null(),
  output: watchesSchema,
  run(database) {
    const { kysely, execute } = createSyncKysely<EngineTables>(database);
    const query = kysely
      .selectFrom("shell_watches")
      .select(["job", "agent_id", "command", "folder", "started_at", "surface"])
      .orderBy("started_at")
      .orderBy("job");
    return execute(query).rows.map((row) =>
      shellWatchRecordSchema.parse({
        job: row.job,
        agentId: row.agent_id,
        command: row.command,
        folder: row.folder,
        startedAtMs: row.started_at,
        surface: row.surface,
      }),
    );
  },
});
