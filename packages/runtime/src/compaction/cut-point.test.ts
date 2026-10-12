import { describe, expect, it } from "vitest";
import { transcriptOf } from "../testing/transcript-events.js";
import { cutPoint, estimateEventTokens } from "./cut-point.js";

// Each word is 40 characters, 10 tokens, so an owner's or agent's event costs 14.
const words = (n: number): string => "x".repeat(40 * n);

describe("cutPoint", () => {
  it("keeps the newest turns that fit, starting at a turn's start", () => {
    const events = transcriptOf([
      [{ owner: words(1) }, { agent: words(1) }],
      [{ owner: words(1) }, { agent: words(1) }],
      [{ owner: words(1) }, { agent: words(1) }],
    ]);
    expect(events.map(estimateEventTokens)).toStrictEqual([14, 14, 14, 14, 14, 14]);
    expect(cutPoint(events, 28)).toBe(4);
    expect(cutPoint(events, 56)).toBe(2);
  });

  it("starts inside a turn, at a response, when no turn's start fits", () => {
    const events = transcriptOf([
      [{ owner: words(1) }, { agent: words(1) }],
      [{ owner: words(1) }, { agent: words(1) }, { agent: words(1) }],
    ]);
    expect(cutPoint(events, 28)).toBe(3);
  });

  it("never cuts between a call and its result, even with an owner's message held between", () => {
    const events = transcriptOf([
      [{ owner: words(1) }, { agent: words(1) }],
      [
        { owner: words(1) },
        { agent: "" },
        { call: "c1" },
        { owner: words(1) },
        { result: "c1", text: words(1) },
        { agent: words(1) },
      ],
    ]);
    // The owner's message at 5 waits behind the call at 4, whose result is at 6: no cut there.
    expect(cutPoint(events, 50)).toBe(7);
    expect(cutPoint(events, 80)).toBe(2);
  });

  it("compacts the whole history when nothing of it fits", () => {
    const events = transcriptOf([[{ owner: words(5) }, { agent: words(5) }]]);
    expect(cutPoint(events, 10)).toBe(2);
  });

  it("has no cut for an empty history", () => {
    expect(cutPoint([], 1_000)).toBeUndefined();
  });
});
