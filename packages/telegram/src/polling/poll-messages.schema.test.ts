import { BinferenceError } from "@binference/core";
import { describe, expect, it } from "vitest";
import {
  polledBatchOf,
  pollFaultOf,
  pollReplyOf,
  pollRequestOf,
  pollSetupOf,
} from "./poll-messages.schema.js";

describe("the poll worker's messages", () => {
  it("reads a getUpdates answer and refuses one without whole update ids", () => {
    expect(polledBatchOf([{ update_id: 3, message: { text: "x" } }])).toStrictEqual([
      { updateId: 3, update: { update_id: 3, message: { text: "x" } } },
    ]);
    for (const answer of [{ ok: true }, [{ message: {} }], [{ update_id: -1 }]]) {
      expect(() => polledBatchOf(answer)).toThrow(
        expect.objectContaining({ code: "telegram.bad_answer", retryable: true }),
      );
    }
  });

  it("reads requests, replies and setups, and nothing else", () => {
    expect(pollRequestOf({ kind: "fetch", id: 1, offset: 4 })).toStrictEqual({
      kind: "fetch",
      id: 1,
      offset: 4,
    });
    expect(pollRequestOf({ kind: "fetch", id: 0 })).toBeUndefined();
    expect(pollReplyOf({ kind: "updates", id: 1, updates: [] })).toStrictEqual({
      kind: "updates",
      id: 1,
      updates: [],
    });
    expect(
      pollReplyOf({ kind: "fault", id: 1, fault: { code: "not a code", retryable: false } }),
    ).toBeUndefined();
    expect(pollSetupOf({ token: "1:a", apiRoot: "http://127.0.0.1:8081" })).toStrictEqual({
      token: "1:a",
      apiRoot: "http://127.0.0.1:8081",
    });
    expect(() => pollSetupOf({ token: "" })).toThrow(/token/);
  });

  it("sends a fault by its code, and any other error as a failed poller", () => {
    const flood = new BinferenceError({
      code: "telegram.flood",
      message: "wait",
      retryable: true,
      details: { retryAfterMs: 3000 },
    });
    expect(pollFaultOf(flood)).toStrictEqual({
      code: "telegram.flood",
      retryable: true,
      retryAfterMs: 3000,
    });
    expect(pollFaultOf(new TypeError("boom"))).toStrictEqual({
      code: "telegram.poller_failed",
      retryable: false,
    });
  });
});
