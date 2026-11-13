import type { Clock } from "@binference/core";
import { createManualClock } from "@binference/core/testing";
import { describe, expect, it } from "vitest";
import {
  type CommitIdentity,
  type CommitReading,
  type CommitStatus,
  nextCommitStep,
  resolveCommit,
} from "./commit-step.js";

const identity: CommitIdentity = {
  transactionId: "742",
  processId: 31,
  sessionStart: "2026-11-13 09:00:00.1+00",
  serverStart: "2026-11-13 08:00:00.2+00",
};

const status = (
  state: "committed" | "aborted" | "in progress" | undefined,
  isAlive = true,
): CommitReading => ({ kind: "status", status: state, isAlive });

const early = { elapsedMs: 0, hasEnded: false };
const never = new AbortController().signal;

interface FakeStatus extends CommitStatus {
  readonly asked: () => number;
  readonly ended: () => number;
  /** The time each ask and end was given, in order. */
  readonly given: () => readonly number[];
}

// A database that answers each ask with the next reading, the last one ever after; with a clock,
// each ask takes `askMs` of it, or the time it was given if that is less, as an ask the network
// holds gives up at its deadline.
function statusOf(
  readings: readonly CommitReading[],
  slow?: { readonly clock: Clock; readonly askMs: number },
): FakeStatus {
  let asked = 0;
  let ended = 0;
  const given: number[] = [];
  return {
    ask: async (_identity, call) => {
      asked += 1;
      given.push(call.timeoutMs);
      if (slow !== undefined) {
        await slow.clock.sleep(Math.min(slow.askMs, call.timeoutMs), never);
        return { kind: "unreachable" };
      }
      return readings[Math.min(asked, readings.length) - 1] ?? { kind: "unreachable" };
    },
    end: async (_identity, call) => {
      ended += 1;
      given.push(call.timeoutMs);
    },
    asked: () => asked,
    ended: () => ended,
    given: () => given,
  };
}

describe("nextCommitStep", () => {
  it.each([
    [status("committed"), "committed"],
    [status("aborted"), "rerun"],
    [status(undefined), "unknown"],
    [{ kind: "other_server" } as const, "unknown"],
    [status("in progress"), "ask_again"],
    [{ kind: "unreachable" } as const, "ask_again"],
  ])("answers %o early with %s", (reading, step) => {
    expect(nextCommitStep(reading, early)).toBe(step);
  });

  it("ends a session still in its transaction after 3 s, once, and only while it runs", () => {
    const late = { elapsedMs: 3_000, hasEnded: false };
    expect(nextCommitStep(status("in progress"), { ...late, elapsedMs: 2_999 })).toBe("ask_again");
    expect(nextCommitStep(status("in progress"), late)).toBe("end_session");
    expect(nextCommitStep(status("in progress"), { ...late, hasEnded: true })).toBe("ask_again");
    expect(nextCommitStep(status("in progress", false), late)).toBe("ask_again");
  });

  it("cannot tell once 10 s passed without a final answer", () => {
    const spent = { elapsedMs: 10_000, hasEnded: true };
    expect(nextCommitStep(status("in progress"), spent)).toBe("unknown");
    expect(nextCommitStep({ kind: "unreachable" }, { ...early, elapsedMs: 10_000 })).toBe(
      "unknown",
    );
    expect(nextCommitStep(status("committed"), spent)).toBe("committed");
  });
});

describe("resolveCommit", () => {
  it("runs a write that wrote nothing again without asking", async () => {
    const parts = { status: statusOf([]), clock: createManualClock(0), stop: never };
    const { transactionId: _none, ...nothing } = identity;
    await expect(resolveCommit(nothing, parts)).resolves.toBe("rerun");
    expect(parts.status.asked()).toBe(0);
  });

  it("asks every 100 ms until the database answers", async () => {
    const clock = createManualClock(0);
    const readings = [status("in progress"), status("committed")];
    const parts = { status: statusOf(readings), clock, stop: never };
    const resolving = resolveCommit(identity, parts);
    await clock.advance(100);
    await expect(resolving).resolves.toBe("committed");
    expect(parts.status.asked()).toBe(2);
  });

  it("ends the held session after 3 s, then reads that it did not land", async () => {
    const clock = createManualClock(0);
    const readings = [
      ...Array.from({ length: 31 }, () => status("in progress")),
      status("aborted"),
    ];
    const parts = { status: statusOf(readings), clock, stop: never };
    const resolving = resolveCommit(identity, parts);
    await clock.advance(3_000);
    await expect(resolving).resolves.toBe("rerun");
    expect(parts.status.ended()).toBe(1);
  });

  it("cannot tell when the database is never reached within 10 s", async () => {
    const clock = createManualClock(0);
    const parts = { status: statusOf([{ kind: "unreachable" }]), clock, stop: never };
    const resolving = resolveCommit(identity, parts);
    await clock.advance(10_000);
    await expect(resolving).resolves.toBe("unknown");
    expect(parts.status.ended()).toBe(0);
  });

  it("gives each ask only what is left of the 10 s, and starts none once they passed", async () => {
    const clock = createManualClock(0);
    const parts = { status: statusOf([], { clock, askMs: 4_000 }), clock, stop: never };
    let end = "";
    const resolving = resolveCommit(identity, parts).then((step) => {
      end = step;
      return step;
    });
    await clock.advance(9_999);
    expect(end).toBe("");
    await clock.advance(1);
    await expect(resolving).resolves.toBe("unknown");
    expect(parts.status.given()).toStrictEqual([10_000, 5_900, 1_800]);
  });

  it("starts no ask once the 10 s passed between two asks", async () => {
    const clock = createManualClock(0);
    const parts = { status: statusOf([], { clock, askMs: 50 }), clock, stop: never };
    const resolving = resolveCommit(identity, parts);
    await clock.advance(10_050);
    await expect(resolving).resolves.toBe("unknown");
    expect(Math.min(...parts.status.given())).toBe(100);
    expect(parts.status.asked()).toBe(67);
  });

  it("gives a session end only what is left of the 10 s", async () => {
    const clock = createManualClock(0);
    const readings = Array.from({ length: 32 }, () => status("in progress"));
    const parts = { status: statusOf([...readings, status("aborted")]), clock, stop: never };
    const resolving = resolveCommit(identity, parts);
    await clock.advance(3_100);
    await expect(resolving).resolves.toBe("rerun");
    expect(parts.status.given().slice(30, 33)).toStrictEqual([7_000, 7_000, 7_000]);
  });

  it("stops where it is once COMMIT's own answer came, and ends no session", async () => {
    const clock = createManualClock(0);
    const stop = new AbortController();
    const reason = new Error("COMMIT answered");
    const parts = { status: statusOf([status("in progress")]), clock, stop: stop.signal };
    const resolving = resolveCommit(identity, parts);
    await clock.advance(200);
    stop.abort(reason);
    await expect(resolving).rejects.toBe(reason);
    await clock.advance(5_000);
    expect(parts.status.asked()).toBe(3);
    expect(parts.status.ended()).toBe(0);
  });
});
