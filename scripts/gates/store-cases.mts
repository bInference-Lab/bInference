import { readFileSync } from "node:fs";
import { join } from "node:path";
import { failingCase, type GateCase } from "./gate-case.mjs";

const releasedMigration = "packages/store/src/migrations/engine/0001_meta.ts";

function seeded(source: readonly string[], file = "seeded.ts"): Readonly<Record<string, string>> {
  return { [`packages/store/src/${file}`]: `${source.join("\n")}\n` };
}

function finding(message: string): RegExp {
  return new RegExp(`check:store: packages/store/src/seeded\\.ts:\\d+:\\d+: ${message}`);
}

const intentWrite = [
  "export function confirm(db: { updateTable(table: string): any }): void {",
  '  db.updateTable("intents").set({ state: "confirmed" });',
  "}",
];

const downStep = [
  'import type { Migration } from "../migration.js";',
  "",
  "export const migration: Migration = {",
  '  name: "0003_seeded",',
  "  up(database) {",
  '    database.exec("CREATE TABLE seeded (id INTEGER PRIMARY KEY)");',
  "  },",
  "  down(database) {",
  '    database.exec("DROP TABLE seeded");',
  "  },",
  "};",
];

const syncTask = [
  'import { z } from "zod";',
  'import { createSyncKysely } from "./dialect/sync-kysely.js";',
  'import { defineTask } from "./tasks/store-task.js";',
  "",
  "interface Tables {",
  "  ledger: { seq: number; hash: string };",
  "}",
  "",
  "export const appendHash = defineTask({",
  '  name: "seeded.append",',
  '  access: "write",',
  "  input: z.string(),",
  "  output: z.null(),",
  "  run(database, hash) {",
  "    const { kysely, execute } = createSyncKysely<Tables>(database);",
  '    execute(kysely.insertInto("ledger").values({ seq: 1, hash }));',
  "    return null;",
  "  },",
  "});",
];

function ruleCases(): readonly GateCase[] {
  return [
    failingCase(
      "an async transaction callback fails check:store",
      seeded([
        'import type { DatabaseSync } from "node:sqlite";',
        'import { writeTransaction } from "./sqlite/transaction.js";',
        "",
        "export function save(database: DatabaseSync): void {",
        "  writeTransaction(database, async () => {});",
        "}",
      ]),
      ["check:store", finding("A transaction callback is synchronous")],
    ),
    failingCase(
      "raw SQL outside a migration fails check:store",
      seeded([
        "export function wipe(database: { exec(sql: string): void }): void {",
        '  database.exec("DELETE FROM meta");',
        "}",
      ]),
      ["check:store", finding("Raw SQL belongs in a migration")],
    ),
    failingCase(
      "a deleteFrom on the ledger fails check:store",
      seeded([
        "export function prune(db: { deleteFrom(table: string): any }): void {",
        '  db.deleteFrom("ledger");',
        "}",
      ]),
      ["check:store", finding("The ledger is append-only")],
    ),
    failingCase(
      "node:sqlite outside a worker entry fails check:store",
      seeded([
        'import { DatabaseSync } from "node:sqlite";',
        "",
        'export const database = new DatabaseSync(":memory:");',
      ]),
      ["check:store", finding("Open node:sqlite only in a worker entry")],
    ),
  ];
}

function migrationCases(repo: string): readonly GateCase[] {
  const released = readFileSync(join(repo, releasedMigration), "utf8");
  return [
    failingCase(
      "an edit to a released migration fails check:store",
      { [releasedMigration]: released.replace("value TEXT NOT NULL", "value TEXT") },
      [
        "check:store",
        /check:store: packages\/store\/src\/migrations\/engine\/0001_meta\.ts: this migration is released/,
      ],
    ),
    {
      name: "a down step, a numbering gap and a second intent-state writer fail check:store",
      files: {
        ...seeded(intentWrite),
        ...seeded(intentWrite, "seeded-twin.ts"),
        "packages/store/src/migrations/engine/0003_seeded.ts": `${downStep.join("\n")}\n`,
      },
      steps: [
        {
          command: ["pnpm", "check:store"],
          expect: "fail",
          output: [
            /0003_seeded\.ts:\d+:\d+: Migrations are forward-only/,
            /0003_seeded\.ts: migrations are numbered from 0001 with no gap/,
            finding("2 files write intents.state"),
          ],
        },
      ],
    },
    {
      name: "a task that writes the ledger synchronously passes check:store",
      files: seeded(syncTask),
      steps: [{ command: ["pnpm", "check:store"], expect: "pass" }],
    },
  ];
}

/** Cases for check:store: one per store rule, and code that follows them. */
export function storeCases(repo: string): readonly GateCase[] {
  return [...ruleCases(), ...migrationCases(repo)];
}
