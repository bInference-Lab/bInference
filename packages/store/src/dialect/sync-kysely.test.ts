import type { CompiledQuery, QueryResult } from "kysely";
import { describe, expect, it } from "vitest";
import type { PostgresTaskConnection } from "./store-connection.js";
import { createSyncKysely } from "./sync-kysely.js";

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
