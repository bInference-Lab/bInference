import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { agentWorker } from "../databases/agent-database.js";
import { engineWorker } from "../databases/engine-database.js";
import { agentMigrations } from "../migrations/agent/agent-migrations.js";
import { engineMigrations } from "../migrations/engine/engine-migrations.js";
import { runMigrations } from "../migrations/run-migrations.js";
import { writeSchemaVersion } from "../migrations/schema-version.js";
import { openConnection } from "../sqlite/open-connection.worker.js";
import { defineTask } from "../tasks/store-task.js";
import {
  failAfterWrite,
  probeDatabase,
  probeWorker,
  recordWrite,
  summarize,
} from "../testing/probe-database.js";
import { openDatabase, type DatabaseHandle, type OpenDatabaseOptions } from "./open-database.js";

// Workers run the TypeScript source: tsx loads it, and the source condition resolves workspace
// packages to their src, as the test run itself does.
const execArgv = ["--conditions=@binference/source", "--import", "tsx"];
// Starting a worker compiles the store's source on first use; the work itself takes well under
// a second.
const workerTest = { timeout: 60_000 };

const opened: DatabaseHandle[] = [];
let folder = "";

function databaseFile(name = "probe.sqlite"): string {
  if (folder === "") {
    folder = mkdtempSync(join(tmpdir(), "bnf-store-"));
  }
  return join(folder, name);
}

async function open(options: Partial<OpenDatabaseOptions> = {}): Promise<DatabaseHandle> {
  const handle = await openDatabase({
    file: databaseFile(),
    worker: probeWorker,
    readers: 0,
    execArgv,
    signal: AbortSignal.timeout(30_000),
    ...options,
  });
  opened.push(handle);
  return handle;
}

// Each call gets its own 30 s: one signal made at import would bound the whole file.
const call = (): { readonly signal: AbortSignal } => ({ signal: AbortSignal.timeout(30_000) });

// Every worker closes its connection before the folder goes: Windows refuses to delete a file
// that a connection still holds.
afterEach(async () => {
  await Promise.all(opened.splice(0).map(async (handle) => handle.close()));
  if (folder !== "") {
    rmSync(folder, { recursive: true, force: true, maxRetries: 5 });
    folder = "";
  }
});

describe("openDatabase", () => {
  it("loses none of 1,000 writes from four writer workers on one file", workerTest, async () => {
    const handles = await Promise.all([0, 1, 2, 3].map(async () => open()));
    const migrations = await Promise.all(handles.map(async (handle) => handle.migrate(call())));

    const counters = await Promise.all(
      handles.flatMap((handle, writer) =>
        Array.from({ length: 250 }, async (_, seq) =>
          handle.run(recordWrite, { writer, seq }, call()),
        ),
      ),
    );
    const summary = await handles[0]?.run(summarize, null, call());
    const integrity = await handles[1]?.checkIntegrity(call());

    expect(migrations.flatMap((report) => report.applied)).toStrictEqual([
      "0001_meta",
      "0002_probe_tables",
    ]);
    expect(new Set(counters).size).toBe(1_000);
    expect(summary).toStrictEqual({
      rows: 1_000,
      pairs: 1_000,
      counter: 1_000,
      writers: [0, 1, 2, 3].map((writer) => ({ writer, count: 250, firstSeq: 0, lastSeq: 249 })),
    });
    expect(integrity).toMatchObject({ ok: true, integrity: ["ok"], schemaVersion: 2 });
  });

  it(
    "runs one handle's writes one at a time, in the order they were sent",
    workerTest,
    async () => {
      const handle = await open();
      await handle.migrate(call());

      const counters = await Promise.all(
        Array.from({ length: 200 }, async (_, seq) =>
          handle.run(recordWrite, { writer: 0, seq }, call()),
        ),
      );

      expect(counters).toStrictEqual(Array.from({ length: 200 }, (_, index) => index + 1));
    },
  );

  it("refuses a file whose schema is newer than this build knows", workerTest, async () => {
    const file = databaseFile();
    const database = openConnection(file, { role: "writer", synchronous: "normal" });
    runMigrations(database, probeDatabase);
    writeSchemaVersion(database, 9);
    database.close();

    await expect(open({ file })).rejects.toMatchObject({
      code: "store.newer_schema",
      details: { database: "probe", schemaVersion: 9, supportedVersion: 2 },
    });
  });

  it("serves reads, integrity checks and VACUUM INTO on a reader", workerTest, async () => {
    const handle = await open({ readers: 2 });
    await handle.migrate(call());
    await handle.run(recordWrite, { writer: 0, seq: 0 }, call());
    const target = databaseFile("copy.sqlite");

    const summary = await handle.run(summarize, null, call());
    const integrity = await handle.checkIntegrity(call());
    const copy = await handle.vacuumInto(target, call());
    const again = await handle.vacuumInto(target, call());

    expect(handle).toMatchObject({ name: "probe", schemaVersion: 0, latestVersion: 2 });
    expect(summary).toMatchObject({ rows: 1, counter: 1 });
    expect(integrity.ok).toBe(true);
    expect(copy).toMatchObject({ ok: true, value: { file: target } });
    expect(existsSync(target)).toBe(true);
    expect(again).toStrictEqual({ ok: false, error: "target_exists" });
  });

  it("rolls back a write task that fails and rejects with its error", workerTest, async () => {
    const handle = await open();
    await handle.migrate(call());

    await expect(handle.run(failAfterWrite, { writer: 0, seq: 0 }, call())).rejects.toMatchObject({
      code: "probe.failed",
    });
    await expect(handle.run(summarize, null, call())).resolves.toMatchObject({
      rows: 0,
      counter: 0,
    });
  });

  it("refuses a task its database does not list", workerTest, async () => {
    const handle = await open();
    const stranger = defineTask({
      name: "probe.stranger",
      access: "read",
      input: z.null(),
      output: z.null(),
      run: () => null,
    });

    await expect(handle.run(stranger, null, call())).rejects.toMatchObject({
      code: "store.unknown_task",
    });
  });

  it(
    "stops waiting when the caller aborts, and refuses calls after close",
    workerTest,
    async () => {
      const handle = await open();
      await handle.migrate(call());
      const aborted = { signal: AbortSignal.abort() };

      await expect(handle.run(summarize, null, aborted)).rejects.toMatchObject({
        code: "store.aborted",
      });
      await handle.close();
      await expect(handle.run(summarize, null, call())).rejects.toMatchObject({
        code: "store.closed",
      });
    },
  );

  it("names the file a worker could not open", workerTest, async () => {
    const file = join(databaseFile(), "..", "missing", "probe.sqlite");

    await expect(open({ file })).rejects.toMatchObject({
      code: "store.open_failed",
      details: { file },
    });
  });

  it("opens and migrates the engine and agent databases", workerTest, async () => {
    const engine = await open({ file: databaseFile("engine.sqlite"), worker: engineWorker });
    const agent = await open({
      file: databaseFile("agent.sqlite"),
      worker: agentWorker,
      readers: 1,
    });

    await expect(engine.migrate(call())).resolves.toStrictEqual({
      from: 0,
      to: engineMigrations.length,
      applied: engineMigrations.map((migration) => migration.name),
    });
    await expect(agent.migrate(call())).resolves.toStrictEqual({
      from: 0,
      to: agentMigrations.length,
      applied: agentMigrations.map((migration) => migration.name),
    });
    expect([engine.name, agent.name]).toStrictEqual(["engine", "agent"]);
    await expect(agent.checkIntegrity(call())).resolves.toMatchObject({ ok: true });
  });
});
