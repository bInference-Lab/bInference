import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { BinferenceError } from "@binference/core";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { openConnection, type ConnectionRole } from "../sqlite/open-connection.worker.js";
import { defineTask } from "../tasks/store-task.js";
import { probeDatabase, recordWrite, summarize } from "../testing/probe-database.js";
import { createWorkerContext, handleRequest, type WorkerContext } from "./handle-request.js";
import { toWorkerError } from "./worker-error.js";

let folder = "";
const connections: DatabaseSync[] = [];

function context(role: ConnectionRole): WorkerContext {
  if (folder === "") {
    folder = mkdtempSync(join(tmpdir(), "bnf-store-"));
  }
  const database = openConnection(join(folder, "probe.sqlite"), { role, synchronous: "normal" });
  connections.push(database);
  return createWorkerContext(database, role, probeDatabase);
}

function migrated(): WorkerContext {
  const writer = context("writer");
  handleRequest(writer, { id: 0, kind: "migrate" });
  return writer;
}

afterEach(() => {
  for (const database of connections.splice(0)) {
    database.close();
  }
  rmSync(folder, { recursive: true, force: true, maxRetries: 5 });
  folder = "";
});

describe("handleRequest", () => {
  it("migrates, writes in a transaction and reads", () => {
    const writer = context("writer");

    const migration = handleRequest(writer, { id: 1, kind: "migrate" });
    const write = handleRequest(writer, {
      id: 2,
      kind: "task",
      task: recordWrite.name,
      input: { writer: 0, seq: 0 },
    });
    const read = handleRequest(context("reader"), {
      id: 3,
      kind: "task",
      task: summarize.name,
      input: null,
    });

    expect(migration).toStrictEqual({
      kind: "reply",
      id: 1,
      ok: true,
      value: { from: 0, to: 2, applied: ["0001_meta", "0002_probe_tables"] },
    });
    expect(write).toStrictEqual({ kind: "reply", id: 2, ok: true, value: 1 });
    expect(read).toStrictEqual({
      kind: "reply",
      id: 3,
      ok: true,
      value: {
        rows: 1,
        pairs: 1,
        counter: 1,
        writers: [{ writer: 0, count: 1, firstSeq: 0, lastSeq: 0 }],
      },
    });
  });

  it("rolls back a write task that fails and answers with its error", () => {
    const writer = migrated();

    const reply = handleRequest(writer, {
      id: 4,
      kind: "task",
      task: "probe.fail_after_write",
      input: { writer: 0, seq: 0 },
    });
    const after = handleRequest(writer, { id: 5, kind: "task", task: summarize.name, input: null });

    expect(reply).toMatchObject({ ok: false, error: { code: "probe.failed", retryable: false } });
    expect(after).toMatchObject({ ok: true, value: { rows: 0, counter: 0 } });
  });

  it("answers a unique key violation with the constraint code", () => {
    const writer = migrated();
    const write = {
      id: 6,
      kind: "task",
      task: recordWrite.name,
      input: { writer: 1, seq: 7 },
    } as const;
    handleRequest(writer, write);

    expect(handleRequest(writer, write)).toMatchObject({
      ok: false,
      error: { code: "store.constraint", retryable: false, details: { errcode: 2067 } },
    });
  });

  it("refuses input that fails the task's schema", () => {
    const writer = migrated();

    expect(
      handleRequest(writer, { id: 7, kind: "task", task: recordWrite.name, input: { seq: -1 } }),
    ).toMatchObject({ ok: false, error: { code: "store.task_failed" } });
  });

  it("refuses a task the database does not list", () => {
    expect(
      handleRequest(context("writer"), { id: 8, kind: "task", task: "probe.missing", input: null }),
    ).toMatchObject({
      ok: false,
      error: {
        code: "store.unknown_task",
        details: { database: "probe", task: "probe.missing" },
      },
    });
  });

  it("refuses writes and migrations on a reader", () => {
    const reader = context("reader");

    expect(handleRequest(reader, { id: 9, kind: "migrate" })).toMatchObject({
      ok: false,
      error: { code: "store.writer_only" },
    });
    expect(
      handleRequest(reader, {
        id: 10,
        kind: "task",
        task: recordWrite.name,
        input: { writer: 0, seq: 0 },
      }),
    ).toMatchObject({ ok: false, error: { code: "store.writer_only" } });
  });

  it("checks integrity and writes a VACUUM INTO copy", () => {
    const writer = migrated();
    const target = join(folder, "copy.sqlite");

    expect(handleRequest(writer, { id: 11, kind: "integrity" })).toMatchObject({
      ok: true,
      value: { ok: true, schemaVersion: 2, expectedVersion: 2 },
    });
    expect(handleRequest(writer, { id: 12, kind: "vacuum", target })).toMatchObject({
      ok: true,
      value: { ok: true, value: { file: target } },
    });
  });
});

describe("createWorkerContext", () => {
  it("refuses a definition that lists a task name twice", () => {
    const folderForTest = mkdtempSync(join(tmpdir(), "bnf-store-"));
    const database = openConnection(join(folderForTest, "probe.sqlite"), {
      role: "writer",
      synchronous: "normal",
    });
    const twin = defineTask({
      name: recordWrite.name,
      access: "read",
      input: z.null(),
      output: z.null(),
      run: () => null,
    });
    try {
      expect(() =>
        createWorkerContext(database, "writer", {
          ...probeDatabase,
          tasks: [...probeDatabase.tasks, twin],
        }),
      ).toThrow(expect.objectContaining({ code: "store.duplicate_task" }));
    } finally {
      database.close();
      rmSync(folderForTest, { recursive: true, force: true, maxRetries: 5 });
    }
  });
});

describe("toWorkerError", () => {
  it("keeps a BinferenceError's code, flag and details", () => {
    const error = new BinferenceError({
      code: "store.busy",
      message: "busy",
      retryable: true,
      details: { attempt: 2 },
    });

    expect(toWorkerError(error)).toStrictEqual({
      code: "store.busy",
      message: "busy",
      retryable: true,
      details: { attempt: 2 },
    });
  });

  it("marks SQLite's busy errors as retryable", () => {
    const busy = Object.assign(new Error("database is locked"), {
      errcode: 5,
      errstr: "database is locked",
    });

    expect(toWorkerError(busy)).toStrictEqual({
      code: "store.busy",
      message: "SQLite: database is locked",
      retryable: true,
      details: { errcode: 5, errstr: "database is locked" },
    });
  });

  it("names other SQLite faults and anything else that was thrown", () => {
    const corrupt = Object.assign(new Error("database disk image is malformed"), { errcode: 11 });

    expect(toWorkerError(corrupt)).toMatchObject({
      code: "store.sqlite_failed",
      details: { errcode: 11, errstr: "" },
    });
    expect(toWorkerError("a thrown string")).toStrictEqual({
      code: "store.task_failed",
      message: "a thrown string",
      retryable: false,
      details: {},
    });
  });
});
