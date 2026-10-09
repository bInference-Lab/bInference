import { describe, expect, it } from "vitest";
import type { SendLevelState } from "../agents/send-level-record.js";
import { looseningWaitMs, moveSendLevel, sendLevelAt } from "./send-level-change.js";

const nowMs = 1_700_000_000_000;
const locked: SendLevelState = { level: 3 };
const waiting: SendLevelState = { level: 3, pending: { level: 1, atMs: nowMs + 1_000 } };

describe("the send level in effect", () => {
  it("keeps a looser level pending until its time comes", () => {
    expect(sendLevelAt(waiting, nowMs + 999)).toStrictEqual(waiting);
  });

  it("puts a pending level in effect from its time on", () => {
    expect(sendLevelAt(waiting, nowMs + 1_000)).toStrictEqual({ level: 1 });
  });
});

describe("a move of the send level", () => {
  it("makes a looser level wait 24 hours", () => {
    expect(moveSendLevel(locked, 0, nowMs)).toStrictEqual({
      next: { level: 3, pending: { level: 0, atMs: nowMs + looseningWaitMs } },
      loosens: true,
    });
  });

  it("keeps the time of a looser level already waiting when it is asked again", () => {
    expect(moveSendLevel(waiting, 1, nowMs)).toStrictEqual({ next: waiting, loosens: true });
  });

  it("starts the 24 hours again for another looser level", () => {
    expect(moveSendLevel(waiting, 2, nowMs).next).toStrictEqual({
      level: 3,
      pending: { level: 2, atMs: nowMs + looseningWaitMs },
    });
  });

  it("moves to a stricter level at once and drops a looser one that waits", () => {
    const open: SendLevelState = { level: 1, pending: { level: 0, atMs: nowMs + 1 } };
    expect(moveSendLevel(open, 2, nowMs)).toStrictEqual({ next: { level: 2 }, loosens: false });
  });

  it("drops a looser level that waits when the level in effect is asked", () => {
    expect(moveSendLevel(waiting, 3, nowMs)).toStrictEqual({ next: locked, loosens: false });
  });

  it("judges the move against a pending level whose time has come", () => {
    expect(moveSendLevel(waiting, 2, nowMs + 1_000)).toStrictEqual({
      next: { level: 2 },
      loosens: false,
    });
  });
});
