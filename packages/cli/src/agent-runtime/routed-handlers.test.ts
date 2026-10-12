import { idSchema } from "@binference/core";
import { createRunningTurns } from "@binference/engine/chat";
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
const otherAgent = protocolIdSchema("agent").parse("agt_0190f1c2-3a4b-7c5d-8e6f-000000000002");
const turn = protocolIdSchema("chatTurn").parse("trn_0190f1c2-3a4b-7c5d-8e6f-000000000001");
const runtimeToken = "tok_0190f1c2-3a4b-7c5d-8e6f-000000000042";
const runtimeCaller = {
  credential: runtimeToken,
  client: { kind: "runtime", version: "test" },
  scopes: ["read", "propose", "agent"],
} as const;
const noteView = {
  note: "1",
  agent,
  text: "Remember the token",
  origin: "agent",
  createdAt: 1,
  changedAt: 1,
};

// The engine's record of the runtime's running turns: the agent's turn, marked or not.
function runningTurn(mark: { readonly hasOutsideContent: boolean }) {
  const turns = createRunningTurns();
  turns.startRuntime(idSchema("tok").parse(runtimeToken));
  turns.start({ agent, turn, ...mark });
  return turns;
}

describe("createRoutedHandlers", () => {
  it("covers exactly the operations the protocol marks as answered by the runtime", () => {
    const routed = operationNames.filter((name) => operations[name].answeredBy === "runtime");
    expect([...routedOperations].toSorted()).toStrictEqual(routed.toSorted());
  });

  it("routes for the owner a client with confirm or admin, whatever turn runs", () => {
    const turns = runningTurn({ hasOutsideContent: true });
    expect(originOf(caller, { turns, agent })).toBe("owner");
    expect(originOf({ ...runtimeCaller, scopes: ["read", "admin"] }, { turns, agent })).toBe(
      "owner",
    );
  });

  it("routes for the agent only the runtime in a turn that read no outside content", () => {
    const clean = runningTurn({ hasOutsideContent: false });
    const marked = runningTurn({ hasOutsideContent: true });
    expect(originOf(runtimeCaller, { turns: clean, agent })).toBe("agent");
    expect(originOf(runtimeCaller, { turns: marked, agent })).toBe("untrusted");
    expect(originOf(runtimeCaller, { turns: clean, agent: otherAgent })).toBe("untrusted");
    expect(originOf(runtimeCaller, { turns: clean, agent: undefined })).toBe("untrusted");
    const other = { ...runtimeCaller, credential: "tok_0190f1c2-3a4b-7c5d-8e6f-000000000099" };
    expect(originOf(other, { turns: clean, agent })).toBe("untrusted");
  });

  it("writes the runtime's note from a marked turn as untrusted", async () => {
    const sent: RouteRequest[] = [];
    const turns = runningTurn({ hasOutsideContent: false });
    const handlers = createRoutedHandlers(async (request) => {
      sent.push(request);
      return { ok: true, value: noteView };
    }, turns);
    const call = { args: { agent, text: "Remember the token" }, caller: runtimeCaller, signal };
    await handlers["notes/write"]?.(call);
    turns.mark(agent, turn);
    await handlers["notes/write"]?.(call);
    expect(sent.map((request) => request.origin)).toStrictEqual(["agent", "untrusted"]);
  });

  it("sends the encoded args and answers the result as the operation reads it", async () => {
    const sent: RouteRequest[] = [];
    const handlers = createRoutedHandlers(async (request) => {
      sent.push(request);
      return { ok: true, value: { items: [] } };
    }, createRunningTurns());
    const list = handlers["notes/list"];
    const answer = await list?.({ args: { agent }, caller, signal });
    expect(sent).toStrictEqual([{ op: "notes/list", args: { agent }, origin: "owner" }]);
    expect(answer).toStrictEqual({ ok: true, value: { items: [] } });
  });

  it("passes the runtime's refusal on, and fails a result that breaks the schema", async () => {
    const refused = createRoutedHandlers(
      async () => ({ ok: false, error: "runtime.unavailable" }),
      createRunningTurns(),
    );
    const broken = createRoutedHandlers(
      async () => ({ ok: true, value: { items: "none" } }),
      createRunningTurns(),
    );
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
