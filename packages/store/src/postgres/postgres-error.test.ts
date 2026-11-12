import { DatabaseError } from "pg";
import { describe, expect, it } from "vitest";
import { storeFaultOf } from "./postgres-error.js";

function sent(code: string, message: string): DatabaseError {
  const error = new DatabaseError(message, 0, "error");
  error.code = code;
  return error;
}

const never = new AbortController().signal;

describe("a Postgres store fault", () => {
  it("names a broken constraint a constraint fault, as on SQLite", () => {
    const fault = storeFaultOf(sent("23505", "duplicate key"), never);

    expect(fault).toMatchObject({ code: "store.constraint", details: { sqlState: "23505" } });
  });

  it("names a trigger's refusal a constraint fault, as on SQLite", () => {
    const refused = sent("P0001", "the ledger is append-only");

    expect(storeFaultOf(refused, never)).toMatchObject({
      code: "store.constraint",
      details: { sqlState: "P0001" },
    });
  });

  it("names any other error the server sent a Postgres failure with its code", () => {
    const fault = storeFaultOf(sent("22023", "invalid parameter value"), never);

    expect(fault).toMatchObject({ code: "store.postgres_failed", details: { sqlState: "22023" } });
  });
});
