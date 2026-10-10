import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { openConnection } from "../sqlite/open-connection.worker.js";
import { engineMigrations } from "./engine/engine-migrations.js";
import { runMigrations } from "./run-migrations.js";

const folders: string[] = [];
const connections: DatabaseSync[] = [];

afterEach(() => {
  for (const database of connections.splice(0)) {
    database.close();
  }
  for (const folder of folders.splice(0)) {
    rmSync(folder, { recursive: true, force: true, maxRetries: 5 });
  }
});

function connect(): DatabaseSync {
  const folder = mkdtempSync(join(tmpdir(), "bnf-notice-intents-"));
  folders.push(folder);
  const database = openConnection(join(folder, "engine.sqlite"), {
    role: "writer",
    synchronous: "full",
  });
  connections.push(database);
  return database;
}

const index = engineMigrations.findIndex((migration) => migration.name === "0018_notice_intents");

// A notice of the whole install, as the tables before 0018 hold it.
function insertNotice(database: DatabaseSync, id: string): void {
  database
    .prepare(
      `INSERT INTO notices (id, agent_id, kind, i18n_key, "values", level, at, delivered)
        VALUES (?, NULL, 'locked', 'notice.locked', '{"values":{}}', 'critical', 1, '{}')`,
    )
    .run(id);
}

describe("the notice intents migration", () => {
  it("keeps a notice stored before it, naming no intent", () => {
    const database = connect();
    runMigrations(database, { name: "engine", migrations: engineMigrations.slice(0, index) });
    insertNotice(database, "ntc_1");

    runMigrations(database, { name: "engine", migrations: engineMigrations });

    expect(database.prepare("SELECT id, intent_id AS intent FROM notices").all()).toEqual([
      { id: "ntc_1", intent: null },
    ]);
  });
});
