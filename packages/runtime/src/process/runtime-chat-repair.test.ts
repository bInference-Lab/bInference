import { createManualClock } from "@binference/core/testing";
import {
  createMemoryAgentDatabase,
  createMemoryChatQueueStore,
  createMemoryGoalStore,
  createMemoryHelperStore,
  createMemoryNoteStore,
  createMemorySessionStore,
  createMemoryTranscriptStore,
  createMemoryWriterFence,
  type MemoryAgentDatabase,
} from "@binference/store/testing";
import { describe, expect, it } from "vitest";
import { createMemoryAgentStores, nthTestId } from "../testing/memory-agent-stores.js";
import type { AgentDatabase } from "./agent-database.js";
import { prepareChat } from "./runtime-chat.js";

const agent = nthTestId("agt", 1);
const go = (): { readonly signal: AbortSignal } => ({ signal: new AbortController().signal });

function databaseOn(rows: MemoryAgentDatabase): AgentDatabase {
  return {
    fence: createMemoryWriterFence(rows),
    sessions: createMemorySessionStore(rows),
    transcript: createMemoryTranscriptStore(rows),
    queue: createMemoryChatQueueStore(rows),
    helpers: createMemoryHelperStore(rows),
    goals: createMemoryGoalStore(rows),
    notes: createMemoryNoteStore(rows),
    schemaVersion: 6,
    close: async () => Promise.resolve(),
  };
}

describe("a start after a crash", () => {
  it("repairs a helper's unfinished turn without telling the engine of it", async () => {
    const rows = createMemoryAgentDatabase();
    const { stores } = await createMemoryAgentStores(rows);
    const { fence } = stores;
    const parent = nthTestId("ses", 1);
    const opened = { id: parent, agentId: agent, surface: "cli", conversation: "cli" };
    await stores.sessions.open({ ...opened, startedAtMs: 1, fence }, go());
    const helper = nthTestId("ses", 2);
    const draft = { id: helper, agentId: agent, parentSessionId: parent, label: "news" };
    await createMemoryHelperStore(rows).start(
      { ...draft, startedAtMs: 2, timeoutMs: 600_000, fence },
      go(),
    );
    const turns = [
      { id: nthTestId("trn", 1), sessionId: parent },
      { id: nthTestId("trn", 2), sessionId: helper },
    ];
    for (const turn of turns) {
      // oxlint-disable-next-line eslint/no-await-in-loop -- one write at a time
      await stores.sessions.startTurn(
        { ...turn, startedAtMs: 3, outsideContent: false, fence },
        go(),
      );
    }
    const prepared = await prepareChat(databaseOn(rows), {
      clock: createManualClock(10),
      signal: go().signal,
    });
    expect(prepared.repaired.map(({ turn }) => turn)).toStrictEqual([nthTestId("trn", 1)]);
    const repaired = await prepared.stores.sessions.turn(nthTestId("trn", 2), go());
    expect(repaired?.outcome).toBe("failed");
  });
});
