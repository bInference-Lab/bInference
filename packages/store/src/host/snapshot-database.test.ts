import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { agentWorker } from "../databases/agent-database.js";
import { knownSchemaVersions } from "../migrations/known-schema-versions.js";
import { isDatabaseLeftOpen } from "./database-left-open.js";
import { openDatabase } from "./open-database.js";
import { snapshotDatabase } from "./snapshot-database.js";

const execArgv = ["--conditions=@binference/source", "--import", "tsx"];
const workerTest = { timeout: 60_000 };
const folders: string[] = [];

function scratch(): string {
  const folder = mkdtempSync(join(tmpdir(), "bnf-snap-"));
  folders.push(folder);
  return folder;
}

const signal = (): AbortSignal => AbortSignal.timeout(30_000);

afterEach(() => {
  folders.splice(0).forEach((folder) => {
    rmSync(folder, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  });
});

async function migratedAgentDatabase(file: string): Promise<void> {
  const database = await openDatabase({ file, worker: agentWorker, execArgv, signal: signal() });
  try {
    await database.migrate({ signal: signal() });
  } finally {
    await database.close();
  }
}

describe("a snapshot of a database no handle holds", () => {
  it("answers not_found for a file that is not there and creates nothing", async () => {
    const folder = scratch();
    const file = join(folder, "agent.sqlite");

    const outcome = await snapshotDatabase({
      file,
      worker: agentWorker,
      target: join(folder, "copy.sqlite"),
      execArgv,
      signal: signal(),
    });

    expect(outcome).toStrictEqual({ ok: false, error: "not_found" });
    expect([existsSync(file), existsSync(join(folder, "copy.sqlite"))]).toStrictEqual([
      false,
      false,
    ]);
  });

  it("copies the database with its schema version and leaves it closed", workerTest, async () => {
    const folder = scratch();
    const file = join(folder, "agent.sqlite");
    const target = join(folder, "copy.sqlite");
    await migratedAgentDatabase(file);

    const outcome = await snapshotDatabase({
      file,
      worker: agentWorker,
      target,
      execArgv,
      signal: signal(),
    });
    const again = await snapshotDatabase({
      file,
      worker: agentWorker,
      target,
      execArgv,
      signal: signal(),
    });

    expect(outcome).toMatchObject({
      ok: true,
      value: { file: target, schemaVersion: knownSchemaVersions().agent },
    });
    expect(again).toStrictEqual({ ok: false, error: "target_exists" });
    expect(await isDatabaseLeftOpen(file, signal())).toBe(false);
  });
});

describe("the schema versions this build knows", () => {
  it("counts each database's migrations", () => {
    const versions = knownSchemaVersions();

    expect(versions.engine).toBeGreaterThanOrEqual(20);
    expect(versions.agent).toBeGreaterThanOrEqual(3);
  });
});
