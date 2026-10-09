import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { progressedState, type TransactionProgress } from "./transaction-progress.js";
import type { TransactionState } from "./transaction-record.js";

const states: readonly TransactionState[] = [
  "built",
  "signed",
  "sent",
  "included",
  "final",
  "reverted",
  "dropped",
  "superseded",
];

const progresses: readonly TransactionProgress[] = [
  { kind: "send", accepted: true },
  { kind: "send", accepted: false },
  { kind: "receipt", status: "success" },
  { kind: "receipt", status: "reverted" },
  { kind: "final" },
  { kind: "reorg" },
  { kind: "superseded" },
  { kind: "dropped" },
];

describe("the progress of a stored transaction", () => {
  it.each<[TransactionState, TransactionProgress, TransactionState | undefined]>([
    ["signed", { kind: "send", accepted: false }, "signed"],
    ["signed", { kind: "send", accepted: true }, "sent"],
    ["sent", { kind: "send", accepted: false }, "sent"],
    ["built", { kind: "send", accepted: true }, undefined],
    ["included", { kind: "send", accepted: true }, undefined],
    ["signed", { kind: "receipt", status: "success" }, "included"],
    ["sent", { kind: "receipt", status: "reverted" }, "reverted"],
    ["included", { kind: "receipt", status: "success" }, "included"],
    ["final", { kind: "receipt", status: "success" }, undefined],
    ["included", { kind: "final" }, "final"],
    ["reverted", { kind: "final" }, undefined],
    ["sent", { kind: "final" }, undefined],
    ["included", { kind: "reorg" }, "sent"],
    ["reverted", { kind: "reorg" }, "sent"],
    ["final", { kind: "reorg" }, undefined],
    ["superseded", { kind: "receipt", status: "success" }, "included"],
    ["dropped", { kind: "receipt", status: "reverted" }, "reverted"],
    ["signed", { kind: "superseded" }, "superseded"],
    ["sent", { kind: "superseded" }, "superseded"],
    ["included", { kind: "superseded" }, undefined],
    ["sent", { kind: "dropped" }, "dropped"],
    ["superseded", { kind: "dropped" }, undefined],
  ])("moves %s on %o to %s", (state, progress, expected) => {
    expect(progressedState(state, progress)).toBe(expected);
  });

  it("never moves a final transaction", () => {
    fc.assert(
      fc.property(fc.constantFrom(...progresses), (progress) => {
        expect(progressedState("final", progress)).toBeUndefined();
      }),
    );
  });

  it("moves a dropped or superseded transaction only into the block that holds it", () => {
    fc.assert(
      fc.property(
        fc.constantFrom<TransactionState>("dropped", "superseded"),
        fc.constantFrom(...progresses.filter(({ kind }) => kind !== "receipt")),
        (state, progress) => {
          expect(progressedState(state, progress)).toBeUndefined();
        },
      ),
    );
  });

  it("never moves a transaction back to signed", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...states.filter((state) => state !== "signed")),
        fc.constantFrom(...progresses),
        (state, progress) => {
          expect(progressedState(state, progress)).not.toBe("signed");
        },
      ),
    );
  });
});
