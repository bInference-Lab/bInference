import { describe, expect, it } from "vitest";
import { turnEngineContract, type TurnEngineSubject } from "../contracts/turn-engine-contract.js";
import { turnJournalContract } from "../contracts/turn-journal-contract.js";
import type { TurnRefusal } from "../loop/turn-records.js";
import { recordedEngine, recordedJournal } from "./recorded-views.js";
import { createTurnRecorder } from "./turn-recorder.js";

function engineSubject(refuse: TurnRefusal | undefined): TurnEngineSubject {
  const recorder = createTurnRecorder(refuse === undefined ? {} : { refuse });
  return {
    engine: recorder.engine,
    messages: ["msg_1"],
    read: async () => recordedEngine(recorder.steps, { refused: refuse !== undefined }),
  };
}

describe("createTurnRecorder", () => {
  it.each(
    turnJournalContract({
      create: async () => {
        const recorder = createTurnRecorder();
        return {
          journal: recorder.journal,
          read: async () => recordedJournal(recorder.steps),
        };
      },
    }),
  )("keeps the journal contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });

  it.each(
    turnEngineContract({
      create: async ({ refuse }) => engineSubject(refuse),
    }),
  )("keeps the engine contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });
});
