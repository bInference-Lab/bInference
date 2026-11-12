import { idSchema } from "@binference/core";
import { createMemoryLogger, createSeededRandom } from "@binference/core/testing";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { openPostgres, type PostgresDatabase } from "../postgres/open-postgres.js";
import type { PostgresConnection } from "../postgres/postgres-connection.js";
import { createTestPostgresDatabase, type TestPostgresDatabase } from "../testing/test-postgres.js";
import type { InstallSchemas } from "./install-schemas.js";
import { createPostgresInstall } from "./postgres-install.js";
import { prepareSharedSchema } from "./prepare-shared-schema.js";

// The few columns these tests write, typed as the store reads them back.
interface Tables {
  ledger: {
    seq: number;
    id: string;
    at: number;
    kind: string;
    data: string;
    prev_hash: string;
    hash: string;
  };
  inbox: { id?: number; source: string; source_key: string; payload: string; received_at: number };
  agents: {
    id: string;
    name: string;
    mode: string;
    locale: string;
    models: string;
    notifications: string;
    created_at: number;
    changed_at: number;
  };
  carried_outflows: {
    intent_id: string;
    agent_id: string;
    paper: number;
    confirmed_at: number;
    value_usd_micros: string;
    carried_at: number;
  };
  notices: {
    id: string;
    kind: string;
    i18n_key: string;
    values: string;
    level: string;
    at: number;
    delivered: string;
    seq?: number;
  };
  meta: { key: string; value: string };
  sessions: {
    id: string;
    agent_id: string;
    surface: string;
    conversation: string;
    started_at: number;
  };
  transcript_events: {
    id?: number;
    session_id: string;
    seq: number;
    role: string;
    kind: string;
    content: string;
    at: number;
  };
}

const url = inject("postgres");
const never = new AbortController().signal;
const sharedSchema = "shared";
const zeroHash = "0".repeat(64);

type Work<Output> = (connection: PostgresConnection<Tables>) => Promise<Output>;

function entry(seq: number, prevHash: string): Tables["ledger"] {
  return {
    seq,
    id: `led_${String(seq)}`,
    at: seq,
    kind: "test",
    data: "{}",
    prev_hash: prevHash,
    hash: String(seq).repeat(64).slice(0, 64),
  };
}

function agent(id: string): Tables["agents"] {
  return {
    id,
    name: id,
    mode: "paper",
    locale: "en",
    models: "{}",
    notifications: "{}",
    created_at: 1,
    changed_at: 1,
  };
}

function inboxRow(key: string): Tables["inbox"] {
  return { source: "telegram", source_key: key, payload: "{}", received_at: 1 };
}

function outflow(change: Partial<Tables["carried_outflows"]>): Tables["carried_outflows"] {
  return {
    intent_id: "int_refused",
    agent_id: "agt_refused",
    paper: 0,
    confirmed_at: 1,
    value_usd_micros: "1",
    carried_at: 1,
    ...change,
  };
}

function notice(id: string, seq: number): Tables["notices"] {
  return { id, kind: "k", i18n_key: "k", values: "{}", level: "info", at: 1, delivered: "{}", seq };
}

describe.runIf(url !== "")("the Postgres schemas' triggers and checks", () => {
  let server: TestPostgresDatabase;
  let database: PostgresDatabase<Tables>;
  let schemas: InstallSchemas;
  const write = async <Output>(work: Work<Output>): Promise<Output> => database.write(work, never);

  beforeAll(async () => {
    server = await createTestPostgresDatabase(url);
    database = await openPostgres<Tables>(server.settings, {
      clock: { now: () => 0, sleep: async () => Promise.resolve() },
      random: createSeededRandom(9),
      logger: createMemoryLogger({ subsystem: "store" }),
      signal: never,
    });
    await prepareSharedSchema(database, sharedSchema, never);
    const installId = idSchema("ins").parse("ins_0190f1c2-3a4b-7c5d-8e6f-000000000001");
    schemas = await createPostgresInstall(database, { installId, sharedSchema }, never);
  });

  afterAll(async () => {
    await database.close();
    await server.drop();
  });

  it("appends a ledger entry that takes the next seq and the last hash", async () => {
    const appended = await write(async ({ kysely, execute }) => {
      const engine = kysely.withSchema(schemas.engine);
      await execute(engine.insertInto("ledger").values(entry(1, zeroHash)));
      await execute(engine.insertInto("ledger").values(entry(2, entry(1, zeroHash).hash)));
      return execute(engine.selectFrom("ledger").select("seq").orderBy("seq"));
    });
    expect(appended.rows).toStrictEqual([{ seq: 1 }, { seq: 2 }]);
  });

  it.each([
    ["a seq past the next", entry(4, entry(2, zeroHash).hash)],
    ["a hash off the chain", entry(3, zeroHash)],
  ])("refuses a ledger entry with %s as a constraint fault", async (_case, refused) => {
    const writing = write(async ({ kysely, execute }) =>
      execute(kysely.withSchema(schemas.engine).insertInto("ledger").values(refused)),
    );
    await expect(writing).rejects.toThrow(
      "a ledger entry takes the next seq and the last entry's hash",
    );
    await expect(writing).rejects.toMatchObject({
      code: "store.constraint",
      details: { sqlState: "P0001" },
    });
  });

  it("refuses a change or a removal of a ledger entry", async () => {
    await expect(
      write(async ({ kysely, execute }) =>
        execute(kysely.withSchema(schemas.engine).updateTable("ledger").set({ kind: "x" })),
      ),
    ).rejects.toThrow("the ledger is append-only");
    await expect(
      write(async ({ kysely, execute }) =>
        execute(kysely.withSchema(schemas.engine).deleteFrom("ledger")),
      ),
    ).rejects.toThrow("the ledger is append-only");
  });

  it("numbers a write-order key from its counter, past any value an insert names", async () => {
    const ids = await write(async ({ kysely, execute }) => {
      const engine = kysely.withSchema(schemas.engine);
      await execute(engine.insertInto("inbox").values(inboxRow("a")));
      await execute(engine.insertInto("inbox").values({ ...inboxRow("b"), id: 10 }));
      await execute(engine.insertInto("inbox").values(inboxRow("c")));
      return execute(engine.selectFrom("inbox").select(["source_key", "id"]).orderBy("id"));
    });
    expect(ids.rows).toStrictEqual([
      { source_key: "a", id: 1 },
      { source_key: "b", id: 10 },
      { source_key: "c", id: 11 },
    ]);
  });

  it("numbers each notice in the order it was written, whatever the insert named", async () => {
    const rows = await write(async ({ kysely, execute }) => {
      const engine = kysely.withSchema(schemas.engine);
      await execute(engine.insertInto("notices").values(notice("ntc_b", 0)));
      await execute(engine.insertInto("notices").values(notice("ntc_a", 7)));
      return execute(engine.selectFrom("notices").select(["id", "seq"]).orderBy("seq"));
    });
    expect(rows.rows).toStrictEqual([
      { id: "ntc_b", seq: 1 },
      { id: "ntc_a", seq: 2 },
    ]);
  });

  it("keeps an amount past 64 bits and reads it back as SQLite's decimal text", async () => {
    const amount = (2n ** 64n + 1n).toString();
    const row = await write(async ({ kysely, execute, takeFirst }) => {
      const engine = kysely.withSchema(schemas.engine);
      await execute(engine.insertInto("agents").values(agent("agt_amount")));
      await execute(
        engine.insertInto("carried_outflows").values({
          intent_id: "int_amount",
          agent_id: "agt_amount",
          paper: 1,
          confirmed_at: 2,
          value_usd_micros: amount,
          carried_at: 3,
        }),
      );
      return takeFirst(engine.selectFrom("carried_outflows").selectAll());
    });
    expect(row).toStrictEqual({
      intent_id: "int_amount",
      agent_id: "agt_amount",
      paper: 1,
      confirmed_at: 2,
      value_usd_micros: amount,
      carried_at: 3,
    });
  });

  it.each([
    ["an amount below zero", "{}", outflow({ value_usd_micros: "-1" })],
    ["a flag that is not 0 or 1", "{}", outflow({ paper: 2 })],
    ["a text that is not JSON", "{", outflow({})],
  ])("refuses %s", async (_case, models, row) => {
    await expect(
      write(async ({ kysely, execute }) => {
        const engine = kysely.withSchema(schemas.engine);
        await execute(engine.insertInto("agents").values({ ...agent("agt_refused"), models }));
        await execute(engine.insertInto("carried_outflows").values(row));
      }),
    ).rejects.toMatchObject({ details: { sqlState: "23514" } });
  });

  it("refuses a change of a transcript event, and its removal until it is older than the prune line", async () => {
    await write(async ({ kysely, execute }) => {
      const agentSchema = kysely.withSchema(schemas.agent);
      await execute(
        agentSchema.insertInto("sessions").values({
          id: "ses_1",
          agent_id: "agt_1",
          surface: "telegram",
          conversation: "c",
          started_at: 1,
        }),
      );
      await execute(
        agentSchema.insertInto("transcript_events").values({
          session_id: "ses_1",
          seq: 1,
          role: "owner",
          kind: "text",
          content: "{}",
          at: 100,
        }),
      );
    });
    const update = write(async ({ kysely, execute }) =>
      execute(kysely.withSchema(schemas.agent).updateTable("transcript_events").set({ at: 5 })),
    );
    await expect(update).rejects.toThrow("the transcript is append-only");
    const removal = write(async ({ kysely, execute }) =>
      execute(kysely.withSchema(schemas.agent).deleteFrom("transcript_events")),
    );
    await expect(removal).rejects.toThrow("the transcript is append-only");
    const removed = await write(async ({ kysely, execute }) => {
      const agentSchema = kysely.withSchema(schemas.agent);
      await execute(agentSchema.insertInto("meta").values({ key: "prune_before", value: "101" }));
      return execute(agentSchema.deleteFrom("transcript_events"));
    });
    expect(removed.numAffectedRows).toBe(1n);
  });

  it("names each table's schema in a query, since the search path is empty", async () => {
    await expect(
      write(async ({ kysely, execute }) => execute(sql`select * from ledger`.compile(kysely))),
    ).rejects.toMatchObject({ details: { sqlState: "42P01" } });
  });
});
