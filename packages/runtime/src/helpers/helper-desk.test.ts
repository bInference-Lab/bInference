import type { Id, JsonValue } from "@binference/core";
import type { HelperRecord } from "@binference/store";
import { describe, expect, it } from "vitest";
import type { ModelEvent } from "../loop/model-event.js";
import { startHelperRig, type HelperRig } from "../testing/helper-rig.js";
import { nthTestId } from "../testing/memory-agent-stores.js";
import { callsReply, type ScriptedReply, textReply } from "../testing/scripted-transport.js";
import { readingText } from "../tools/helper-answers.js";
import type { HelperReading, HelperRunner, HelperStartRequest } from "./helper-desk.js";

const go = (): { readonly signal: AbortSignal } => ({ signal: new AbortController().signal });

// A model call that never answers until the run is halted.
const hangs: ScriptedReply = (signal) =>
  (async function* (): AsyncGenerator<ModelEvent> {
    await new Promise((resolve) => {
      signal.addEventListener("abort", resolve, { once: true });
    });
    yield { type: "error", failure: "aborted", message: "Stopped." };
  })();

function requestOf(rig: HelperRig, label: string): HelperStartRequest {
  return { agent: rig.agent, from: { session: rig.parent }, task: "Find news.", label };
}

// Starts a helper the test expects the desk to take.
async function started(
  rig: HelperRig,
  request: HelperStartRequest = requestOf(rig, "BNB news"),
): Promise<HelperRecord> {
  const answer = await rig.desk.start(request, go().signal);
  expect(answer.ok).toBe(true);
  const [helper] = await rig.helpers.list({ agentId: rig.agent, limit: 1 }, go());
  if (helper?.label !== request.label) {
    throw new Error("The helper the desk took is not the one asked for.");
  }
  return helper;
}

// A helper the desk holds for the agent, as `helper_read` reads it.
async function readingOf(rig: HelperRig, helper: Id<"ses">): Promise<HelperReading> {
  const reading = await rig.desk.read({ agent: rig.agent, helper }, go().signal);
  if (reading === undefined) {
    throw new Error("The desk holds no such helper.");
  }
  return reading;
}

// Whether a follow-up waits, or why it was refused.
function answerOf(sent: Awaited<ReturnType<HelperRunner["send"]>>): boolean | string {
  return sent.ok ? sent.value.queued : sent.error;
}

async function stateOf(rig: HelperRig, helper: Id<"ses">): Promise<HelperRecord | undefined> {
  return rig.helpers.get(helper, go());
}

// The args of each `helper/ended` the desk sent the engine, as JSON text.
function endsOf(rig: HelperRig): readonly string[] {
  return rig.client
    .calls()
    .filter(({ op }) => op === "helper/ended")
    .map(({ args }: { readonly args: JsonValue }) => JSON.stringify(args));
}

describe("the agent's helpers", () => {
  it("runs a helper in its own session with a read tool and tells the agent its report", async () => {
    const rig = await startHelperRig({
      replies: [callsReply([{ name: "token_info" }]), textReply("BNB is quiet today.")],
      tools: [{ name: "token_info", kind: "read" }],
    });
    const helper = await started(rig);
    await rig.desk.rested();
    const done = await stateOf(rig, helper.id);
    expect([done?.state, done?.runs, done?.outside, done?.parentSessionId]).toStrictEqual([
      "done",
      1,
      false,
      rig.parent,
    ]);
    expect(rig.places.map(({ session, helper: turn }) => [session, turn])).toStrictEqual([
      [helper.id, {}],
    ]);
    const task = rig.transport.requests[0]?.messages[0];
    expect(task?.role).toBe("owner");
    expect(JSON.stringify(task)).toContain("Find news.");
    const ends = endsOf(rig);
    expect(ends).toHaveLength(1);
    expect(ends[0]).toContain(`"helper":"${helper.id}"`);
    expect(ends[0]).toContain('"surface":"telegram"');
    expect(ends[0]).toContain('"outsideContent":false');
    expect(ends[0]).toContain("BNB is quiet today.");
    // Each model call is charged to the agent's budget, under the helper's own turn.
    expect(rig.engine.usage.map(({ agent }) => agent)).toStrictEqual([rig.agent, rig.agent]);
    expect(rig.budgets.leftOf(rig.agent)).toBe(1_000_000n);
  });

  it("marks the wake-up when the helper read outside content, and its record for good", async () => {
    const rig = await startHelperRig({
      replies: [callsReply([{ name: "search_web" }]), textReply("A post says buy.")],
      tools: [{ name: "search_web", kind: "read", outside: true }],
    });
    const helper = await started(rig);
    await rig.desk.rested();
    expect((await stateOf(rig, helper.id))?.outside).toBe(true);
    expect(endsOf(rig)[0]).toContain('"outsideContent":true');
    const read = readingText(await readingOf(rig, helper.id), rig.clock.now());
    expect([read.outside, read.text.includes("A post says buy.")]).toStrictEqual([true, true]);
  });

  it("keeps up to 4 follow-ups for a running helper, then refuses more", async () => {
    const rig = await startHelperRig({ replies: [hangs] });
    const helper = await started(rig);
    const sent: (boolean | string)[] = [];
    for (const n of [1, 2, 3, 4, 5]) {
      const follow = { agent: rig.agent, helper: helper.id, message: `Check ${String(n)}.` };
      // oxlint-disable-next-line eslint/no-await-in-loop -- one follow-up at a time
      sent.push(answerOf(await rig.desk.send(follow, go().signal)));
    }
    expect(sent).toStrictEqual([true, true, true, true, "busy"]);
    rig.desk.stopAgent(rig.agent);
    await rig.desk.rested();
    expect(rig.transport.requests).toHaveLength(1);
  });

  it("refuses a fifth helper while four run, then stops the agent's helpers unannounced", async () => {
    const rig = await startHelperRig({ replies: [hangs, hangs, hangs, hangs] });
    for (const n of [1, 2, 3, 4]) {
      // oxlint-disable-next-line eslint/no-await-in-loop -- one start at a time
      await started(rig, requestOf(rig, `h${String(n)}`));
    }
    const fifth = await rig.desk.start(requestOf(rig, "h5"), go().signal);
    expect(fifth).toStrictEqual({ ok: false, error: "too_many" });
    rig.desk.stopAgent(rig.agent);
    await rig.desk.rested();
    const all = await rig.desk.list(rig.agent, go().signal);
    expect(all.map(({ state }) => state)).toStrictEqual([
      "stopped",
      "stopped",
      "stopped",
      "stopped",
    ]);
    expect(endsOf(rig)).toStrictEqual([]);
  });

  it("ends a run at its time limit and tells the agent it ran out of time", async () => {
    const rig = await startHelperRig({ replies: [hangs] });
    const helper = await started(rig, { ...requestOf(rig, "slow"), timeoutMinutes: 1 });
    await rig.clock.advance(60_000);
    await rig.desk.rested();
    const ended = await stateOf(rig, helper.id);
    expect([ended?.state, ended?.timeoutMs]).toStrictEqual(["timed_out", 60_000]);
    expect(endsOf(rig)[0]).toContain("ran out of its 1 minutes");
  });

  it("stops one running helper on the agent's word and answers it as it ended", async () => {
    const rig = await startHelperRig({ replies: [hangs] });
    const helper = await started(rig);
    const stopped = await rig.desk.stop({ agent: rig.agent, helper: helper.id }, go().signal);
    expect(stopped).toMatchObject({ ok: true, value: { id: helper.id, state: "stopped" } });
    const again = await rig.desk.stop({ agent: rig.agent, helper: helper.id }, go().signal);
    expect(again).toStrictEqual({ ok: false, error: "not_running" });
    const other = { agent: nthTestId("agt", 2), helper: helper.id };
    expect(await rig.desk.stop(other, go().signal)).toStrictEqual({
      ok: false,
      error: "not_found",
    });
    expect(endsOf(rig)).toStrictEqual([]);
  });

  it("refuses a start once the budget is spent and a model no provider serves", async () => {
    const rig = await startHelperRig({ replies: [] });
    const request = requestOf(rig, "x");
    const unknown = await rig.desk.start({ ...request, model: "other/model" }, go().signal);
    expect(unknown).toStrictEqual({ ok: false, error: "unknown_model" });
    rig.budgets.note(rig.agent, 0n);
    expect(await rig.desk.start(request, go().signal)).toStrictEqual({
      ok: false,
      error: "budget",
    });
    expect(await rig.desk.list(rig.agent, go().signal)).toStrictEqual([]);
  });

  it("runs a follow-up as a new run of the helper, with the conversation it had", async () => {
    const rig = await startHelperRig({
      replies: [textReply("First report."), textReply("Second report.")],
    });
    const helper = await started(rig);
    await rig.desk.rested();
    const follow = { agent: rig.agent, helper: helper.id, message: "And the volume?" };
    const sent = await rig.desk.send(follow, go().signal);
    expect(sent).toMatchObject({ ok: true, value: { queued: false } });
    await rig.desk.rested();
    expect(endsOf(rig)).toHaveLength(2);
    const ended = await stateOf(rig, helper.id);
    expect([ended?.state, ended?.runs]).toStrictEqual(["done", 2]);
    const second = rig.transport.requests[1]?.messages.map(({ role }) => role);
    expect(second).toStrictEqual(["owner", "agent", "owner"]);
    const reading = await rig.desk.read({ agent: rig.agent, helper: helper.id }, go().signal);
    expect(reading?.run?.said).toStrictEqual(["Second report."]);
  });

  it("ends a helper a stop left running at the next start, and tells its agent once", async () => {
    const before = await startHelperRig({ replies: [hangs, hangs] });
    const first = await started(before, requestOf(before, "one"));
    const second = await started(before, requestOf(before, "two"));
    await before.desk.stopAll();
    expect((await stateOf(before, first.id))?.state).toBe("running");
    const after = await startHelperRig({ replies: [], database: before.database });
    await after.desk.repair(go().signal);
    expect((await stateOf(after, first.id))?.state).toBe("stopped");
    expect((await stateOf(after, second.id))?.state).toBe("stopped");
    const ends = endsOf(after);
    expect(ends).toHaveLength(1);
    expect(ends[0]).toContain('\\"one\\"');
    expect(ends[0]).toContain('\\"two\\"');
    expect(ends[0]).toContain('"outsideContent":false');
  });
});
