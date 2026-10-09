import type { AccountRef } from "@binference/chain";
import { describe, expect, it } from "vitest";
import { cancelRescue, changeRescue, type RescueState, rescueAt } from "./rescue-change.js";
import { looseningWaitMs } from "./send-level-change.js";

const nowMs = 1_700_000_000_000;
const owner = "fake:1:owner" as AccountRef;
const other = "fake:1:other" as AccountRef;
const waiting: RescueState = {
  rescueAddress: owner,
  pendingRescue: { address: other, atMs: nowMs + 1_000 },
};

describe("the rescue address in effect", () => {
  it("keeps a new address pending until its time comes, then pays it", () => {
    expect(rescueAt(waiting, nowMs + 999)).toStrictEqual(waiting);
    expect(rescueAt(waiting, nowMs + 1_000)).toStrictEqual({ rescueAddress: other });
  });
});

describe("a change of the rescue address", () => {
  it("makes a new address wait 24 hours", () => {
    expect(changeRescue({ rescueAddress: owner }, other, nowMs)).toStrictEqual({
      rescueAddress: owner,
      pendingRescue: { address: other, atMs: nowMs + looseningWaitMs },
    });
  });

  it("makes a first address wait 24 hours too", () => {
    expect(changeRescue({}, owner, nowMs)).toStrictEqual({
      pendingRescue: { address: owner, atMs: nowMs + looseningWaitMs },
    });
  });

  it("keeps the time of the address that already waits when it is asked again", () => {
    expect(changeRescue(waiting, other, nowMs)).toStrictEqual(waiting);
  });

  it("drops the address that waits when the address in effect is asked", () => {
    expect(changeRescue(waiting, owner, nowMs)).toStrictEqual({ rescueAddress: owner });
  });

  it("is cancelled without touching the address in effect", () => {
    expect(cancelRescue(waiting, nowMs)).toStrictEqual({ rescueAddress: owner });
    expect(cancelRescue(waiting, nowMs + 1_000)).toStrictEqual({ rescueAddress: other });
    expect(cancelRescue({}, nowMs)).toStrictEqual({});
  });
});
