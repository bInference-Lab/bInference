import assert from "node:assert/strict";
import type { ContractCheck } from "@binference/core/testing";
import { answerOf, assertOneWon, race, settled } from "@binference/engine/testing";
import type { ChatQueueStore, WriterFence } from "../ports.js";
import { go, nthId } from "./agent-fixtures.js";

// Writers that insert one key their caller chose at once (decision 0413), on the agent database's
// stores: the first to commit stores it, and every other gets the port's own answer, never a
// broken constraint, whether it read the key first or met it on a rerun.

/** One writer of an install's agent database: the stores whose writes answer a key in use. */
interface AgentRaceWriter {
  readonly queue: ChatQueueStore;
}

/**
 * Writers of one agent database that race, and its writer fence. Each writer runs its own writes
 * in order; the writers run at once.
 */
export interface AgentRaceSubject {
  readonly writers: readonly AgentRaceWriter[];
  readonly fence: WriterFence;
  /**
   * How many writes the writers ran again after a conflict so far, on a database that retries:
   * where it is given, each race must meet at least one.
   */
  readonly retries?: () => number;
}

/** Makes a fresh database with its racing writers for each check. */
export interface AgentRaceHarness {
  create(): Promise<AgentRaceSubject>;
}

/** Writers that add one message to the chat queue store it once; the others answer `exists`. */
async function addsOneMessage(subject: AgentRaceSubject): Promise<void> {
  const fence = await subject.fence.raise(go());
  const answers = await race(subject, async ({ queue }, index) => {
    const draft = {
      message: nthId("msg", 1),
      agentId: nthId("agt", 1),
      sessionId: nthId("ses", 1),
      kind: "inbox/message",
      payload: { text: `pushed by ${String(index)}` },
      receivedAtMs: 1_000 + index,
    } as const;
    return answerOf(await settled(queue.add({ ...draft, fence }, go())));
  });
  assertOneWon(answers, "exists");
  const [writer] = subject.writers;
  const waiting = await writer?.queue.waiting({ limit: 10 }, go());
  assert.deepEqual(
    waiting?.map((message) => message.payload),
    [{ text: `pushed by ${String(answers.indexOf("ok"))}` }],
  );
}

/** The key races every adapter of the agent database's stores passes. */
export function agentKeyRaces(harness: AgentRaceHarness): readonly ContractCheck[] {
  return [
    {
      name: "writers that add one queued message store it once; the others answer exists",
      run: async () => addsOneMessage(await harness.create()),
    },
  ];
}
