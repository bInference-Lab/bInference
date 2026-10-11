import { idSchema } from "@binference/core";
import { describe, expect, it } from "vitest";
import { createRunningTurns } from "./running-turns.js";

const agent = idSchema("agt").parse("agt_0190f1c2-3a4b-7c5d-8e6f-000000000001");
const other = idSchema("agt").parse("agt_0190f1c2-3a4b-7c5d-8e6f-000000000002");
const turn = idSchema("trn").parse("trn_0190f1c2-3a4b-7c5d-8e6f-000000000001");
const next = idSchema("trn").parse("trn_0190f1c2-3a4b-7c5d-8e6f-000000000002");
const runtime = "tok_0190f1c2-3a4b-7c5d-8e6f-000000000003";
const restarted = "tok_0190f1c2-3a4b-7c5d-8e6f-000000000004";

function startedTurns() {
  const turns = createRunningTurns();
  turns.startRuntime(idSchema("tok").parse(runtime));
  turns.start({ agent, turn, hasOutsideContent: false });
  return turns;
}

describe("createRunningTurns", () => {
  it("gives the runtime's current token its agent's running turn mark", () => {
    const turns = startedTurns();
    expect(turns.markOf(runtime, agent)).toStrictEqual({ hasOutsideContent: false });
    expect(turns.markOf(runtime, other)).toBeUndefined();
  });

  it("keeps a mark once set, for the running turn only", () => {
    const turns = startedTurns();
    expect(turns.mark(agent, next)).toBe(false);
    expect(turns.markOf(runtime, agent)).toStrictEqual({ hasOutsideContent: false });
    expect(turns.mark(agent, turn)).toBe(true);
    turns.start({ agent: other, turn: next, hasOutsideContent: false });
    expect(turns.markOf(runtime, agent)).toStrictEqual({ hasOutsideContent: true });
  });

  it("gives no mark to another token, before any start, or after the turn ended", () => {
    const turns = startedTurns();
    expect(turns.markOf(restarted, agent)).toBeUndefined();
    expect(createRunningTurns().markOf(runtime, agent)).toBeUndefined();
    expect(turns.end(agent, next)).toBe(false);
    expect(turns.end(agent, turn)).toBe(true);
    expect(turns.markOf(runtime, agent)).toBeUndefined();
  });

  it("forgets every turn when the runtime exits or starts with a new token", () => {
    const turns = startedTurns();
    turns.clearAll();
    expect(turns.markOf(runtime, agent)).toBeUndefined();
    turns.start({ agent, turn, hasOutsideContent: false });
    turns.startRuntime(idSchema("tok").parse(restarted));
    expect(turns.markOf(restarted, agent)).toBeUndefined();
    turns.start({ agent, turn: next, hasOutsideContent: true });
    expect(turns.markOf(runtime, agent)).toBeUndefined();
    expect(turns.markOf(restarted, agent)).toStrictEqual({ hasOutsideContent: true });
  });
});
