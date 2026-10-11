import { operationNames, operations, protocolIdSchema } from "@binference/protocol";
import { describe, expect, it } from "vitest";
import type { RouteRequest } from "./route-calls.js";
import { createRoutedHandlers, originOf, routedOperations } from "./routed-handlers.js";

const agent = protocolIdSchema("agent").parse("agt_0190f1c2-3a4b-7c5d-8e6f-000000000001");
const caller = {
  credential: "tok_0190f1c2-3a4b-7c5d-8e6f-000000000001",
  client: { kind: "cli", version: "test" },
  scopes: ["read", "propose", "chat", "confirm", "loosen", "admin"],
} as const;
const signal = new AbortController().signal;

describe("createRoutedHandlers", () => {
  it("covers exactly the operations the protocol marks as answered by the runtime", () => {
    const routed = operationNames.filter((name) => operations[name].answeredBy === "runtime");
    expect([...routedOperations].toSorted()).toStrictEqual(routed.toSorted());
  });

  it("routes for the owner a client with confirm or admin, and for the agent any other", () => {
    expect(originOf(caller)).toBe("owner");
    expect(originOf({ scopes: ["read", "admin"] })).toBe("owner");
    expect(originOf({ scopes: ["read", "propose", "agent"] })).toBe("agent");
    expect(originOf({ scopes: ["read", "propose"] })).toBe("agent");
  });

  it("sends the encoded args and answers the result as the operation reads it", async () => {
    const sent: RouteRequest[] = [];
    const handlers = createRoutedHandlers(async (request) => {
      sent.push(request);
      return { ok: true, value: { items: [] } };
    });
    const list = handlers["notes/list"];
    const answer = await list?.({ args: { agent }, caller, signal });
    expect(sent).toStrictEqual([{ op: "notes/list", args: { agent }, origin: "owner" }]);
    expect(answer).toStrictEqual({ ok: true, value: { items: [] } });
  });

  it("passes the runtime's refusal on, and fails a result that breaks the schema", async () => {
    const refused = createRoutedHandlers(async () => ({ ok: false, error: "runtime.unavailable" }));
    const broken = createRoutedHandlers(async () => ({ ok: true, value: { items: "none" } }));
    const call = { args: { agent }, caller, signal };
    await expect(refused["notes/list"]?.(call)).resolves.toStrictEqual({
      ok: false,
      error: "runtime.unavailable",
    });
    await expect(broken["notes/list"]?.(call)).resolves.toStrictEqual({
      ok: false,
      error: "internal.error",
    });
  });
});
