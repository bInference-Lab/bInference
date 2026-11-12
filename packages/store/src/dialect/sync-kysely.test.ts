import type { CompiledQuery, QueryResult, RawBuilder } from "kysely";
import { describe, expect, it } from "vitest";
import type { PostgresTaskConnection } from "./store-connection.js";
import { createSyncKysely } from "./sync-kysely.js";
import type { FullTextIndex } from "./text-search-forms.js";

interface Tables {
  orders: { id: string; agent_id: string; state: string };
  fills: { id: string; order_id: string; amount: string };
}

interface Recorded {
  readonly connection: PostgresTaskConnection;
  readonly sent: { readonly sql: string; readonly parameters: readonly unknown[] }[];
}

// A Postgres task connection that keeps each statement it is sent and answers with `answer`.
function recording(answer: QueryResult<never>): Recorded {
  const sent: Recorded["sent"] = [];
  const connection: PostgresTaskConnection = {
    dialect: "postgres",
    schema: "engine_0190f1c23a4b7c5d8e6f000000000001",
    run: <Row>(query: CompiledQuery<Row>): QueryResult<Row> => {
      sent.push({ sql: query.sql, parameters: query.parameters });
      return answer;
    },
  };
  return { connection, sent };
}

// The rank of Postgres's trigram index; SQLite's FTS5 index ranks inside its own table.
function similarityOf(
  index: FullTextIndex,
): (reference: string, text: string) => RawBuilder<number> {
  if (index.kind !== "trigram") {
    throw new Error("Only Postgres ranks a search by trigram similarity.");
  }
  return index.similarity;
}

// An insert of event 7 that reads its key back.
function insert(into: PostgresTaskConnection): { id: number } {
  const { kysely, takeOne } = createSyncKysely<{ events: { id: number; at: number } }>(into);
  return takeOne(kysely.insertInto("events").values({ id: 7, at: 1 }).returning("id"));
}

describe("createSyncKysely on a Postgres task connection", () => {
  it("names the install's schema on every table and keeps aliases bare", () => {
    const { connection, sent } = recording({ rows: [] });
    const { kysely, execute } = createSyncKysely<Tables>(connection);

    execute(
      kysely
        .selectFrom("orders as order")
        .innerJoin("fills", "fills.order_id", "order.id")
        .select(["order.id", "fills.amount"])
        .where("order.agent_id", "in", kysely.selectFrom("orders").select("agent_id"))
        .where("order.state", "=", "active"),
    );

    expect(sent).toStrictEqual([
      {
        sql:
          'select "order"."id", "engine_0190f1c23a4b7c5d8e6f000000000001"."fills"."amount" ' +
          'from "engine_0190f1c23a4b7c5d8e6f000000000001"."orders" as "order" ' +
          'inner join "engine_0190f1c23a4b7c5d8e6f000000000001"."fills" ' +
          'on "engine_0190f1c23a4b7c5d8e6f000000000001"."fills"."order_id" = "order"."id" ' +
          'where "order"."agent_id" in (select "agent_id" ' +
          'from "engine_0190f1c23a4b7c5d8e6f000000000001"."orders") and "order"."state" = $1',
        parameters: ["active"],
      },
    ]);
  });

  it("sends a write with its values in order and gives back the connection's result", () => {
    const answer: QueryResult<never> = { rows: [], numAffectedRows: 1n };
    const { connection, sent } = recording(answer);
    const { kysely, execute } = createSyncKysely<Tables>(connection);

    const result = execute(
      kysely
        .insertInto("fills")
        .values({ id: "f1", order_id: "o1", amount: "18446744073709551617" })
        .onConflict((conflict) => conflict.column("id").doNothing()),
    );

    expect(result).toBe(answer);
    expect(sent).toStrictEqual([
      {
        sql:
          'insert into "engine_0190f1c23a4b7c5d8e6f000000000001"."fills" ' +
          '("id", "order_id", "amount") values ($1, $2, $3) on conflict ("id") do nothing',
        parameters: ["f1", "o1", "18446744073709551617"],
      },
    ]);
  });

  it("reads the first row of the result", () => {
    const { connection } = recording({ rows: [{ state: "active" } as never] });
    const { kysely, takeFirst } = createSyncKysely<Tables>(connection);

    expect(takeFirst(kysely.selectFrom("orders").select("state"))).toStrictEqual({
      state: "active",
    });
  });

  it("gives the row a statement must give, and fails one that gives none", () => {
    const { connection } = recording({ rows: [{ id: 7 } as never] });
    const empty = recording({ rows: [] }).connection;

    expect(insert(connection)).toStrictEqual({ id: 7 });
    expect(() => insert(empty)).toThrow(expect.objectContaining({ code: "store.no_row" }));
  });

  it("reads a JSON field as text through jsonb, with the alias bare and the path bound", () => {
    const { connection, sent } = recording({ rows: [] });
    const { kysely, execute, jsonField } = createSyncKysely<Tables>(connection);

    execute(
      kysely
        .selectFrom("orders as order")
        .select(jsonField("order.state", ["trigger", "leader"]).as("leader"))
        .where(jsonField("order.state", ["kind"]), "=", "copy"),
    );

    expect(sent).toStrictEqual([
      {
        sql:
          'select ("order"."state"::jsonb #>> $1) as "leader" ' +
          'from "engine_0190f1c23a4b7c5d8e6f000000000001"."orders" as "order" ' +
          'where ("order"."state"::jsonb #>> $2) = $3',
        parameters: ["{trigger,leader}", "{kind}", "copy"],
      },
    ]);
  });

  it("refuses a JSON path key that would need quoting", () => {
    const { connection } = recording({ rows: [] });
    const { jsonField } = createSyncKysely<Tables>(connection);

    expect(() => jsonField("order.state", ["a,b"])).toThrow(
      expect.objectContaining({ code: "store.bad_json_path" }),
    );
    expect(() => jsonField("order.state", [])).toThrow(
      expect.objectContaining({ code: "store.bad_json_path" }),
    );
  });

  it("refuses a JSON path key of digits, which Postgres would read as an array place", () => {
    const { connection } = recording({ rows: [] });
    const { jsonField } = createSyncKysely<Tables>(connection);

    expect(() => jsonField("order.state", ["trigger", "0"])).toThrow(
      expect.objectContaining({ code: "store.bad_json_path" }),
    );
    expect(jsonField("order.state", ["leg2"])).toBeDefined();
  });

  it("counts a JSON array through jsonb and compares decimal text as numeric", () => {
    const { connection, sent } = recording({ rows: [] });
    const { kysely, execute, jsonArrayLength, decimalNumber } =
      createSyncKysely<Tables>(connection);

    execute(
      kysely
        .selectFrom("fills as fill")
        .select("fill.id")
        .where(jsonArrayLength("fill.order_id"), "<=", 2)
        .where((eb) => eb(decimalNumber(eb.ref("fill.amount")), "<", decimalNumber(eb.val("10"))))
        .orderBy((eb) => decimalNumber(eb.ref("fill.amount")), "desc"),
    );

    expect(sent).toStrictEqual([
      {
        sql:
          'select "fill"."id" from "engine_0190f1c23a4b7c5d8e6f000000000001"."fills" as "fill" ' +
          'where jsonb_array_length("fill"."order_id"::jsonb) <= $1 ' +
          'and cast("fill"."amount" as numeric) < cast($2 as numeric) ' +
          'order by cast("fill"."amount" as numeric) desc',
        parameters: [2, "10"],
      },
    ]);
  });

  it("matches text with every LIKE wildcard escaped and ranks it by the schema's similarity", () => {
    const { connection, sent } = recording({ rows: [] });
    const { kysely, execute, holdsText, fullText } = createSyncKysely<Tables>(connection);
    const similarity = similarityOf(fullText);

    execute(
      kysely
        .selectFrom("orders")
        .select("id")
        .where(holdsText("orders.state", "50%_a\\b"))
        .orderBy(similarity("orders.state", "50%_a\\b"), "desc"),
    );

    expect(fullText.kind).toBe("trigram");
    expect(sent).toStrictEqual([
      {
        sql:
          'select "id" from "engine_0190f1c23a4b7c5d8e6f000000000001"."orders" ' +
          'where "engine_0190f1c23a4b7c5d8e6f000000000001"."orders"."state" COLLATE "C" ILIKE $1 ' +
          'order by "engine_0190f1c23a4b7c5d8e6f000000000001"."trigram_similarity"(' +
          '"engine_0190f1c23a4b7c5d8e6f000000000001"."orders"."state", $2) desc',
        parameters: ["%50\\%\\_a\\\\b%", "50%_a\\b"],
      },
    ]);
  });

  it("refuses a value SQLite cannot bind before it sends anything", () => {
    const { connection, sent } = recording({ rows: [] });
    const { kysely, execute } = createSyncKysely<Tables>(connection);
    const query = kysely
      .selectFrom("orders")
      .select("id")
      .where("state", "=", true as never);

    expect(() => execute(query)).toThrow(expect.objectContaining({ code: "store.bad_parameter" }));
    expect(sent).toStrictEqual([]);
  });
});
