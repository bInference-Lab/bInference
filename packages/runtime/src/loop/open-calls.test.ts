import { describe, expect, it } from "vitest";
import { turnJournalContract } from "../contracts/turn-journal-contract.js";
import { recordedJournal } from "../testing/recorded-views.js";
import { createTurnRecorder } from "../testing/turn-recorder.js";
import { trackOpenCalls } from "./open-calls.js";

const live = (): AbortSignal => new AbortController().signal;

describe("trackOpenCalls", () => {
  it.each(
    turnJournalContract({
      create: async () => {
        const recorder = createTurnRecorder();
        return {
          journal: trackOpenCalls(recorder.journal),
          read: async () => recordedJournal(recorder.steps),
        };
      },
    }),
  )("keeps the journal contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });

  it("holds each call written without a result, and whether it is the proposal", async () => {
    const journal = trackOpenCalls(createTurnRecorder().journal);
    const quote = { id: "c1", name: "quote", argumentsText: "{}" };
    const swap = { id: "c2", name: "swap", argumentsText: "{}" };
    await journal.toolCall(quote, live());
    await journal.proposal({ call: swap, idempotencyKey: "trn.2" }, live());
    const result = { callId: "c1", name: "quote", text: "1", isError: false, outside: false };
    await journal.toolResult({ ...result, ran: true }, live());
    expect(journal.open()).toStrictEqual([{ call: swap, proposal: true }]);
  });
});
