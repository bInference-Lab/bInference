import { BinferenceError, type Clock, idSchema } from "@binference/core";
import { createManualClock, createMemoryLogger } from "@binference/core/testing";
import { maxTurnMs } from "@binference/protocol";
import { describe, expect, it } from "vitest";
import { createRunningTurns, lapsedAgentsKept, turnLapseMs } from "./running-turns.js";

const agent = idSchema("agt").parse("agt_0190f1c2-3a4b-7c5d-8e6f-000000000001");
const other = idSchema("agt").parse("agt_0190f1c2-3a4b-7c5d-8e6f-000000000002");
const turn = idSchema("trn").parse("trn_0190f1c2-3a4b-7c5d-8e6f-000000000001");
const next = idSchema("trn").parse("trn_0190f1c2-3a4b-7c5d-8e6f-000000000002");
const runtime = "tok_0190f1c2-3a4b-7c5d-8e6f-000000000003";
const restarted = "tok_0190f1c2-3a4b-7c5d-8e6f-000000000004";

// Another agent of the install, the nth.
const agentOf = (n: number) =>
  idSchema("agt").parse(`agt_0190f1c2-3a4b-7c5d-8e6f-${String(1_000 + n).padStart(12, "0")}`);

function startedTurns() {
  const turns = createRunningTurns({ clock: createManualClock(0) });
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
    expect(
      createRunningTurns({ clock: createManualClock(0) }).markOf(runtime, agent),
    ).toBeUndefined();
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

// The running turns on a manual clock, with every lapse they told.
function watched() {
  const clock = createManualClock(0);
  const turns = createRunningTurns({ clock });
  turns.startRuntime(idSchema("tok").parse(runtime));
  const lapses: string[] = [];
  turns.onLapse(({ turn: lapsed, cause }) => lapses.push(`${lapsed.turn} ${cause}`));
  return { clock, turns, lapses };
}

describe("a running turn whose end never came", () => {
  it("lapses each running turn when the runtime exits or starts again", () => {
    const { turns, lapses } = watched();
    turns.start({ agent, turn, hasOutsideContent: false });
    turns.start({ agent: other, turn: next, hasOutsideContent: false });
    turns.clearAll();
    turns.start({ agent, turn: next, hasOutsideContent: false });
    turns.startRuntime(idSchema("tok").parse(restarted));
    expect(lapses).toStrictEqual([
      `${turn} runtime_exit`,
      `${next} runtime_exit`,
      `${next} runtime_exit`,
    ]);
    expect(turns.runningOf(agent)).toBeUndefined();
  });

  it("lapses the agent's earlier turn when its next turn starts, and no other", () => {
    const { turns, lapses } = watched();
    turns.start({ agent, turn, hasOutsideContent: false });
    turns.start({ agent: other, turn, hasOutsideContent: false });
    turns.start({ agent, turn, hasOutsideContent: true });
    turns.start({ agent, turn: next, hasOutsideContent: false });
    expect(lapses).toStrictEqual([`${turn} next_turn`]);
    expect(turns.runningOf(agent)?.turn).toBe(next);
    expect(turns.runningOf(other)?.turn).toBe(turn);
  });

  it("lapses a turn a minute past the turn's own limit", async () => {
    const { clock, turns, lapses } = watched();
    turns.start({ agent, turn, hasOutsideContent: false });
    expect(turnLapseMs).toBe(maxTurnMs + 60_000);
    await clock.advance(turnLapseMs - 1);
    expect(lapses).toStrictEqual([]);
    await clock.advance(1);
    expect(lapses).toStrictEqual([`${turn} deadline`]);
    expect(turns.runningOf(agent)).toBeUndefined();
  });

  it("never lapses a turn that ended, nor its agent's next turn before that one's own time", async () => {
    const { clock, turns, lapses } = watched();
    turns.start({ agent, turn, hasOutsideContent: false });
    expect(turns.end(agent, turn)).toBe(true);
    turns.start({ agent: other, turn, hasOutsideContent: false });
    await clock.advance(60_000);
    turns.start({ agent: other, turn: next, hasOutsideContent: false });
    await clock.advance(turnLapseMs - 1);
    expect(lapses).toStrictEqual([`${turn} next_turn`]);
    await clock.advance(1);
    expect(lapses).toStrictEqual([`${turn} next_turn`, `${next} deadline`]);
  });

  it("stops each turn's deadline when the turn ends, is replaced or the runtime exits", () => {
    const base = createManualClock(0);
    const waits: AbortSignal[] = [];
    const clock: Clock = {
      now: () => base.now(),
      sleep: async (delayMs, signal) => {
        waits.push(signal);
        return base.sleep(delayMs, signal);
      },
    };
    const turns = createRunningTurns({ clock });
    turns.start({ agent, turn, hasOutsideContent: false });
    turns.end(agent, turn);
    const afterEnd = waits.map((wait) => wait.aborted);
    turns.start({ agent, turn: next, hasOutsideContent: false });
    turns.start({ agent, turn, hasOutsideContent: false });
    const afterNext = waits.map((wait) => wait.aborted);
    turns.clearAll();
    expect([afterEnd, afterNext]).toStrictEqual([[true], [true, true, false]]);
    expect(waits.map((wait) => wait.aborted)).toStrictEqual([true, true, true]);
  });

  it("stops telling a listener that stopped hearing", () => {
    const { turns, lapses } = watched();
    const heard: string[] = [];
    const stop = turns.onLapse(({ cause }) => heard.push(cause));
    turns.start({ agent, turn, hasOutsideContent: false });
    stop();
    turns.clearAll();
    expect(heard).toStrictEqual([]);
    expect(lapses).toStrictEqual([`${turn} runtime_exit`]);
  });

  it("remembers the last turn that lapsed of each agent, never one that ended or runs", () => {
    const turns = createRunningTurns({ clock: createManualClock(0) });
    turns.start({ agent: other, turn, hasOutsideContent: false });
    turns.end(other, turn);
    turns.start({ agent, turn, hasOutsideContent: false });
    turns.start({ agent, turn: next, hasOutsideContent: false });
    const afterNext = [turns.hasLapsed(agent, turn), turns.hasLapsed(agent, next)];
    turns.clearAll();
    const afterExit = [turns.hasLapsed(agent, turn), turns.hasLapsed(agent, next)];
    expect([afterNext, afterExit, turns.hasLapsed(other, turn)]).toStrictEqual([
      [true, false],
      [false, true],
      false,
    ]);
  });

  it("forgets the agent whose turn lapsed longest ago once more agents' turns lapsed", () => {
    const turns = createRunningTurns({ clock: createManualClock(0) });
    turns.start({ agent, turn, hasOutsideContent: false });
    turns.clearAll();
    Array.from({ length: lapsedAgentsKept }, (_, n) => agentOf(n)).forEach((each) =>
      turns.start({ agent: each, turn, hasOutsideContent: false }),
    );
    const beforeExit = turns.hasLapsed(agent, turn);
    turns.clearAll();
    const kept = [agentOf(0), agentOf(lapsedAgentsKept - 1)].map((each) =>
      turns.hasLapsed(each, turn),
    );
    expect([beforeExit, turns.hasLapsed(agent, turn), kept]).toStrictEqual([
      true,
      false,
      [true, true],
    ]);
  });

  it("keeps an agent whose turn lapsed again, and forgets the oldest other one", () => {
    const turns = createRunningTurns({ clock: createManualClock(0) });
    turns.start({ agent, turn, hasOutsideContent: false });
    turns.clearAll();
    Array.from({ length: lapsedAgentsKept - 1 }, (_, n) => agentOf(n)).forEach((each) =>
      turns.start({ agent: each, turn, hasOutsideContent: false }),
    );
    turns.start({ agent, turn: next, hasOutsideContent: false });
    turns.clearAll();
    turns.start({ agent: other, turn, hasOutsideContent: false });
    turns.clearAll();
    const lapsed = [turns.hasLapsed(agent, next), turns.hasLapsed(agentOf(0), turn)];
    expect(lapsed).toStrictEqual([true, false]);
  });

  it("shows a turn that lapsed and then runs again as running, not lapsed", () => {
    const turns = createRunningTurns({ clock: createManualClock(0) });
    turns.start({ agent, turn, hasOutsideContent: false });
    turns.clearAll();
    turns.start({ agent, turn, hasOutsideContent: false });
    expect(turns.hasLapsed(agent, turn)).toBe(false);
  });

  it("logs a listener that throws, and still starts the next turn and tells the others", () => {
    const logger = createMemoryLogger({ subsystem: "engine" });
    const turns = createRunningTurns({ clock: createManualClock(0), logger });
    turns.onLapse(() => {
      throw new BinferenceError({ code: "telegram.unreachable", message: "down" });
    });
    const heard: string[] = [];
    turns.onLapse(({ cause }) => heard.push(cause));
    turns.start({ agent, turn, hasOutsideContent: false });
    turns.start({ agent, turn: next, hasOutsideContent: false });
    turns.clearAll();
    expect(heard).toStrictEqual(["next_turn", "runtime_exit"]);
    expect(logger.records().map(({ event, fields }) => [event, fields])).toStrictEqual([
      ["chat.lapse_unheard", { agentId: agent, traceId: turn, errorCode: "telegram.unreachable" }],
      ["chat.lapse_unheard", { agentId: agent, traceId: next, errorCode: "telegram.unreachable" }],
    ]);
  });

  it("logs a listener's fault that names no code as unexpected", () => {
    const logger = createMemoryLogger({ subsystem: "engine" });
    const turns = createRunningTurns({ clock: createManualClock(0), logger });
    turns.onLapse(() => {
      throw new TypeError("Cannot read properties of undefined");
    });
    turns.start({ agent, turn, hasOutsideContent: false });
    turns.clearAll();
    expect(logger.records().map(({ fields }) => fields)).toStrictEqual([
      { agentId: agent, traceId: turn, errorCode: "unexpected" },
    ]);
  });
});
