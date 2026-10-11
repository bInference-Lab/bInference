import { describe, expect, it } from "vitest";
import { fixtureStartLine } from "../testing/start-line-fixture.js";
import { engineLineSchema, isRoutedOperation, runtimeLineSchema } from "./control-line.schema.js";

function roundTrip(line: unknown): unknown {
  const text = JSON.stringify(engineLineSchema.encode(engineLineSchema.parse(line)));
  return engineLineSchema.parse(JSON.parse(text));
}

describe("the control pipe's lines", () => {
  it("carries a start line with prices above 2^64 as exact decimals", () => {
    const start = fixtureStartLine();
    const wire = JSON.stringify(engineLineSchema.encode(start));
    expect(wire).toContain('"inputPerMTokUsd":"18446744073709551617"');
    expect(engineLineSchema.parse(JSON.parse(wire))).toEqual(start);
  });

  it("refuses a start line whose token is not a client token", () => {
    const wire = engineLineSchema.encode(fixtureStartLine());
    expect(engineLineSchema.safeParse({ ...wire, token: "not-a-token" }).success).toBe(false);
  });

  it("routes only the operations the runtime answers", () => {
    expect(isRoutedOperation("notes/search")).toBe(true);
    expect(isRoutedOperation("chat/messages")).toBe(true);
    expect(isRoutedOperation("intent/propose")).toBe(false);
    expect(isRoutedOperation("nothing/here")).toBe(false);
    const route = { t: "route", id: "r1", op: "notes/list", args: { agent: "x" }, origin: "owner" };
    expect(roundTrip(route)).toEqual(route);
    expect(engineLineSchema.safeParse({ ...route, op: "intent/propose" }).success).toBe(false);
  });

  it("refuses a line with a field it does not know", () => {
    expect(engineLineSchema.safeParse({ t: "stop", extra: 1 }).success).toBe(false);
    expect(
      runtimeLineSchema.safeParse({ t: "ready", version: "1", schemaVersion: 3 }).success,
    ).toBe(true);
    expect(
      runtimeLineSchema.safeParse({ t: "health", runningTurns: 0, waitingMessages: 0, x: 1 })
        .success,
    ).toBe(false);
  });

  it("reads a route reply with a result or with a protocol error", () => {
    const error = { code: "protocol.unknown_op", message: "No.", retryable: false };
    expect(runtimeLineSchema.parse({ t: "routeReply", id: "r1", result: { items: [] } })).toEqual({
      t: "routeReply",
      id: "r1",
      result: { items: [] },
    });
    expect(runtimeLineSchema.parse({ t: "routeReply", id: "r1", error })).toMatchObject({ error });
  });
});
