import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { engineWorker } from "../databases/engine-database.js";
import { isDatabaseLeftOpen } from "./database-left-open.js";
import { openDatabase } from "./open-database.js";

const execArgv = ["--conditions=@binference/source", "--import", "tsx"];
const signal = new AbortController().signal;
const folders: string[] = [];

afterEach(() => {
  folders.splice(0).forEach((folder) => rmSync(folder, { recursive: true, force: true }));
});

function databaseFile(): string {
  const folder = mkdtempSync(join(tmpdir(), "bnf-open-"));
  folders.push(folder);
  return join(folder, "engine.sqlite");
}

describe("whether a database was left open", () => {
  it(
    "is open while a connection runs and closed once the last one closes",
    { timeout: 60_000 },
    async () => {
      const file = databaseFile();
      const database = await openDatabase({ file, worker: engineWorker, execArgv, signal });
      await database.migrate({ signal });

      const whileOpen = await isDatabaseLeftOpen(file, signal);
      await database.close();

      expect([whileOpen, await isDatabaseLeftOpen(file, signal)]).toStrictEqual([true, false]);
    },
  );

  it("is open when only the write-ahead log or the shared-memory index was copied", async () => {
    const wal = databaseFile();
    const shm = databaseFile();
    writeFileSync(`${wal}-wal`, "");
    writeFileSync(`${shm}-shm`, "");

    expect([
      await isDatabaseLeftOpen(wal, signal),
      await isDatabaseLeftOpen(shm, signal),
    ]).toStrictEqual([true, true]);
  });
});
