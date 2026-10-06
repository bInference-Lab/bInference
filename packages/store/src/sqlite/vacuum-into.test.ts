import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openConnection } from "./open-connection.worker.js";
import { vacuumInto, vacuumOutcomeSchema } from "./vacuum-into.js";

let folder = "";
let database: DatabaseSync;

beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), "bnf-store-"));
  database = openConnection(join(folder, "engine.sqlite"), { role: "reader", synchronous: "full" });
});

afterEach(() => {
  database.close();
  rmSync(folder, { recursive: true, force: true, maxRetries: 5 });
});

function seed(): void {
  const writer = openConnection(join(folder, "engine.sqlite"), {
    role: "writer",
    synchronous: "full",
  });
  writer.exec("CREATE TABLE ledger (seq INTEGER PRIMARY KEY, hash TEXT NOT NULL)");
  writer.exec("INSERT INTO ledger (hash) VALUES ('a'), ('b'), ('c')");
  writer.close();
}

describe("vacuumInto", () => {
  it("writes a readable copy from a reader", () => {
    seed();
    const target = join(folder, "copy.sqlite");

    const outcome = vacuumInto(database, target);

    expect(outcome).toMatchObject({ ok: true, value: { file: target } });
    expect(vacuumOutcomeSchema.parse(outcome)).toStrictEqual(outcome);
    const copy = new DatabaseSync(target, { readOnly: true });
    try {
      const hashes = copy.prepare("SELECT hash FROM ledger ORDER BY seq").all();
      expect(hashes.map((row) => row["hash"])).toStrictEqual(["a", "b", "c"]);
      expect(copy.prepare("PRAGMA integrity_check").get()?.["integrity_check"]).toBe("ok");
    } finally {
      copy.close();
    }
  });

  it("keeps a reader read-only after the copy", () => {
    seed();
    vacuumInto(database, join(folder, "copy.sqlite"));

    expect(database.prepare("PRAGMA query_only").get()?.["query_only"]).toBe(1);
    expect(() => database.exec("INSERT INTO ledger (hash) VALUES ('d')")).toThrow(/readonly/);
  });

  it("leaves no partial file when the copy fails", () => {
    const target = join(folder, "missing-folder", "copy.sqlite");

    expect(() => vacuumInto(database, target)).toThrow(/unable to open/);
    expect(existsSync(target)).toBe(false);
  });

  it("never replaces an existing file", () => {
    const target = join(folder, "copy.sqlite");
    writeFileSync(target, "an older copy");

    expect(vacuumInto(database, target)).toStrictEqual({ ok: false, error: "target_exists" });
  });
});
