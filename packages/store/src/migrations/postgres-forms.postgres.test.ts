import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { createMemoryLogger, createSeededRandom } from "@binference/core/testing";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { openPostgres, type PostgresDatabase } from "../postgres/open-postgres.js";
import { openConnection } from "../sqlite/open-connection.worker.js";
import { createTestPostgresDatabase, type TestPostgresDatabase } from "../testing/test-postgres.js";
import { agentPostgresMigrations } from "./agent-postgres/agent-postgres-migrations.js";
import { agentMigrations } from "./agent/agent-migrations.js";
import { enginePostgresMigrations } from "./engine-postgres/engine-postgres-migrations.js";
import { engineMigrations } from "./engine/engine-migrations.js";
import type { Migration } from "./migration.js";
import type { PostgresMigration } from "./postgres-migration.js";
import { prepareSharedSchema } from "./prepare-shared-schema.js";
import { runMigrations } from "./run-migrations.js";
import { type MetaTables, runPostgresMigrations } from "./run-postgres-migrations.js";

// Each schema at one version, as one database or the other holds it: per table, its columns with
// the type each reads back as, its keys, indexes, foreign keys, triggers and the count of checks.
type Shape = Record<string, readonly string[]>;

const url = inject("postgres");
const never = new AbortController().signal;
const sharedSchema = "shared";

// The write-order keys SQLite numbers itself, which Postgres sets by trigger from `counters`
// (database spec, section 6.4).
const counterKeys = new Set([
  "arrivals.id",
  "config_journal.id",
  "departures.id",
  "executions.id",
  "inbox.id",
  "intent_events.id",
  "ledger.seq",
  "model_usage.id",
  "outbox.id",
  "skills.id",
  "stake_unbondings.id",
  "wallet_activity.id",
  "webhook_events.id",
  "notes.id",
  "transcript_events.id",
]);

const cell = (value: unknown): string => String(value);

function sqliteRows(database: DatabaseSync, query: string): readonly Record<string, unknown>[] {
  return database.prepare(query).all();
}

// INTEGER reads back as a number: `smallint` for a 0 or 1 flag, else `bigint`. TEXT holding decimal
// digits, signed or not, reads back as `numeric`; any other TEXT as text.
function sqliteType(column: Record<string, unknown>, tableSql: string): string {
  const name = cell(column["name"]);
  if (cell(column["type"]) === "INTEGER") {
    return new RegExp(`\\b${name} IN \\(0, 1\\)`).test(tableSql) ? "smallint" : "bigint";
  }
  const decimal = [`${name} NOT GLOB '*[^0-9]*'`, `ltrim(${name}, '-') NOT GLOB '*[^0-9]*'`];
  return decimal.some((check) => tableSql.includes(check)) ? "numeric" : "text";
}

function sqliteDefault(value: unknown): string {
  return value === null ? "-" : cell(value).replace(/^'(.*)'$/, "$1");
}

function sqliteTable(database: DatabaseSync, table: string, tableSql: string): readonly string[] {
  const pk = sqliteRows(
    database,
    `SELECT name FROM pragma_table_info('${table}') WHERE pk > 0 ORDER BY pk`,
  );
  const columns = sqliteRows(database, `SELECT * FROM pragma_table_info('${table}')`).map(
    (column) =>
      `column ${cell(column["name"])} ${sqliteType(column, tableSql)} ` +
      `${column["notnull"] === 1 || Number(column["pk"]) > 0 ? "not null" : "null"} ` +
      `default ${sqliteDefault(column["dflt_value"])}`,
  );
  const indexes = sqliteRows(
    database,
    `SELECT name, "unique", partial, origin FROM pragma_index_list('${table}') WHERE origin != 'pk'`,
  ).map((index) => {
    const parts = sqliteRows(
      database,
      `SELECT name FROM pragma_index_info('${cell(index["name"])}') ORDER BY seqno`,
    );
    const named = index["origin"] === "c" ? cell(index["name"]) : "-";
    return `index ${named} ${index["unique"] === 1 ? "unique" : "plain"} ${parts.map((part) => cell(part["name"])).join(",")}${index["partial"] === 1 ? " partial" : ""}`;
  });
  const foreign = sqliteRows(
    database,
    `SELECT group_concat("from", ',') AS cols, "table" AS target, group_concat(coalesce("to", ''), ',') AS refs
      FROM (SELECT * FROM pragma_foreign_key_list('${table}') ORDER BY id, seq) GROUP BY id`,
  ).map((key) => `foreign ${cell(key["cols"])} ${cell(key["target"])}(${cell(key["refs"])})`);
  const triggers = sqliteRows(
    database,
    `SELECT name FROM sqlite_master WHERE type = 'trigger' AND tbl_name = '${table}' AND name NOT GLOB 'notes_fts_*'`,
  ).map((trigger) => `trigger ${cell(trigger["name"])}`);
  const signed = (tableSql.match(/ltrim\(/g) ?? []).length > 0 ? 1 : 0;
  const checks = (tableSql.match(/\bCHECK\b/g) ?? []).length - signed;
  return [
    `key ${pk.map((row) => cell(row["name"])).join(",")}`,
    ...columns,
    ...indexes,
    ...foreign,
    ...triggers,
    `checks ${String(checks)}`,
  ].toSorted();
}

function sqliteShape(database: DatabaseSync): Shape {
  const tables = sqliteRows(
    database,
    "SELECT name, sql FROM sqlite_master WHERE type = 'table'",
  ).filter((table) => !/^sqlite_|^notes_fts/.test(cell(table["name"])));
  return Object.fromEntries(
    tables.map((table) => [
      cell(table["name"]),
      sqliteTable(database, cell(table["name"]), cell(table["sql"])),
    ]),
  );
}

async function postgresRows(
  database: PostgresDatabase<MetaTables>,
  query: ReturnType<typeof sql<{ line: string; tbl: string }>>,
): Promise<readonly { line: string; tbl: string }[]> {
  const result = await database.read(
    async ({ kysely, execute }) => execute(query.compile(kysely)),
    never,
  );
  return result.rows;
}

// Postgres's own forms of what SQLite reports: a type is bigint, smallint, numeric(78,0) or text in
// the C collation; a counter key's trigger and the note index are Postgres's alone.
async function postgresShape(
  database: PostgresDatabase<MetaTables>,
  schema: string,
): Promise<Shape> {
  const lines = await postgresRows(
    database,
    sql`
      select c.relname as tbl, 'key ' || coalesce((select string_agg(a.attname, ',' order by k.ord)
        from pg_constraint p cross join unnest(p.conkey) with ordinality k(num, ord)
        join pg_attribute a on a.attrelid = p.conrelid and a.attnum = k.num
        where p.conrelid = c.oid and p.contype = 'p'), '') as line
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = ${schema} and c.relkind = 'r'
      union all
      select table_name, 'column ' || column_name || ' ' || case
          when data_type = 'numeric' and numeric_precision = 78 and numeric_scale = 0 then 'numeric'
          when data_type = 'text' and collation_name = 'C' then 'text'
          when data_type in ('bigint', 'smallint') then data_type
          else data_type || '?' end
        || ' ' || case is_nullable when 'NO' then 'not null' else 'null' end
        || ' default ' || coalesce(regexp_replace(column_default, '^''?(.*?)''?(::[a-z ]+)?$', '\\1'), '-')
      from information_schema.columns where table_schema = ${schema}
      union all
      select t.relname, 'index ' || case when exists (select from pg_constraint p where p.conindid = i.indexrelid)
            then '-' else ic.relname end || ' '
        || case when i.indisunique then 'unique' else 'plain' end || ' '
        || (select string_agg(a.attname, ',' order by k.ord) from unnest(i.indkey) with ordinality k(num, ord)
            join pg_attribute a on a.attrelid = i.indrelid and a.attnum = k.num)
        || case when i.indpred is null then '' else ' partial' end
      from pg_index i join pg_class ic on ic.oid = i.indexrelid join pg_class t on t.oid = i.indrelid
      join pg_namespace n on n.oid = t.relnamespace
      where n.nspname = ${schema} and not i.indisprimary and ic.relname <> 'notes_text_trgm'
      union all
      select t.relname, 'foreign ' || (select string_agg(a.attname, ',' order by k.ord)
          from unnest(p.conkey) with ordinality k(num, ord)
          join pg_attribute a on a.attrelid = p.conrelid and a.attnum = k.num)
        || ' ' || r.relname || '(' || (select string_agg(a.attname, ',' order by k.ord)
          from unnest(p.confkey) with ordinality k(num, ord)
          join pg_attribute a on a.attrelid = p.confrelid and a.attnum = k.num) || ')'
      from pg_constraint p join pg_class t on t.oid = p.conrelid join pg_class r on r.oid = p.confrelid
      join pg_namespace n on n.oid = t.relnamespace where n.nspname = ${schema} and p.contype = 'f'
      union all
      select t.relname, 'trigger ' || g.tgname from pg_trigger g join pg_class t on t.oid = g.tgrelid
      join pg_namespace n on n.oid = t.relnamespace
      where n.nspname = ${schema} and not g.tgisinternal
      union all
      select c.relname, 'checks ' || (select count(*) from pg_constraint p where p.conrelid = c.oid and p.contype = 'c')
      from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = ${schema} and c.relkind = 'r'`,
  );
  const shape: Record<string, string[]> = {};
  for (const { tbl, line } of lines) {
    const column = /^trigger (\w+)_(\w+)_next$/.exec(line);
    if (
      column === null ||
      !counterKeys.has(`${column[1] ?? ""}.${column[2] ?? ""}`) ||
      column[1] !== tbl
    ) {
      (shape[tbl] ??= []).push(line);
    }
  }
  return Object.fromEntries(Object.entries(shape).map(([table, rows]) => [table, rows.toSorted()]));
}

interface Pair {
  readonly name: string;
  readonly sqlite: readonly Migration[];
  readonly postgres: readonly PostgresMigration[];
}

const pairs: readonly Pair[] = [
  { name: "engine", sqlite: engineMigrations, postgres: enginePostgresMigrations },
  { name: "agent", sqlite: agentMigrations, postgres: agentPostgresMigrations },
];

function differences(version: number, want: Shape, have: Shape): readonly string[] {
  const tables = [...new Set([...Object.keys(want), ...Object.keys(have)])];
  return tables.flatMap((table) => {
    const wanted = new Set(want[table] ?? []);
    const held = new Set(have[table] ?? []);
    const at = `${String(version)} ${table}:`;
    const missing = [...wanted].filter((line) => !held.has(line));
    const extra = [...held].filter((line) => !wanted.has(line));
    return missing
      .map((line) => `${at} missing ${line}`)
      .concat(extra.map((line) => `${at} extra ${line}`));
  });
}

// Migrates both databases one version at a time and compares them after each. `counters` holds
// write-order keys on Postgres from the first migration, and on SQLite only once it needs one.
async function walkVersions(
  pair: Pair,
  databases: { readonly sqlite: DatabaseSync; readonly postgres: PostgresDatabase<MetaTables> },
): Promise<readonly string[]> {
  const schema = `forms_${pair.name}`;
  const found: string[] = [];
  await pair.postgres.reduce(async (before, _migration, index) => {
    await before;
    const version = index + 1;
    runMigrations(databases.sqlite, { name: pair.name, migrations: pair.sqlite.slice(0, version) });
    const plan = { name: pair.name, migrations: pair.postgres.slice(0, version) };
    await runPostgresMigrations(databases.postgres, { schema, plan, sharedSchema }, never);
    const have = await postgresShape(databases.postgres, schema);
    const want = { counters: have["counters"] ?? [], ...sqliteShape(databases.sqlite) };
    found.push(...differences(version, want, have));
  }, Promise.resolve());
  return found;
}

describe.runIf(url !== "")("the Postgres form of each migration", () => {
  const folder = mkdtempSync(join(tmpdir(), "bnf-forms-"));
  let server: TestPostgresDatabase;
  let database: PostgresDatabase<MetaTables>;

  beforeAll(async () => {
    server = await createTestPostgresDatabase(url);
    database = await openPostgres<MetaTables>(server.settings, {
      clock: { now: () => 0, sleep: async () => Promise.resolve() },
      random: createSeededRandom(5),
      logger: createMemoryLogger({ subsystem: "store" }),
      signal: never,
    });
    await prepareSharedSchema(database, sharedSchema, never);
  });

  afterAll(async () => {
    await database.close();
    await server.drop();
    rmSync(folder, { recursive: true, force: true, maxRetries: 5 });
  });

  it.each(pairs)("leaves the $name schema as SQLite's at every version", async (pair) => {
    const sqlite = openConnection(join(folder, `${pair.name}.sqlite`), {
      role: "writer",
      synchronous: "normal",
    });
    try {
      await expect(walkVersions(pair, { sqlite, postgres: database })).resolves.toStrictEqual([]);
    } finally {
      sqlite.close();
    }
  });
});
