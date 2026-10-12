import assert from "node:assert/strict";
import type { ContractCheck } from "@binference/core/testing";
import type { LiveFactsReader } from "../loop/ports.js";

/** A reader of one agent's facts, and a switch that makes the engine stop answering. */
export interface LiveFactsReaderSubject {
  readonly reader: LiveFactsReader;
  readonly agent: string;
  readonly goDown: () => void;
}

/** Makes a fresh subject for each check. */
export interface LiveFactsReaderHarness {
  create(): Promise<LiveFactsReaderSubject>;
}

const live = (): AbortSignal => new AbortController().signal;

/**
 * The contract every {@link LiveFactsReader} keeps: it reads the agent's facts, answers
 * `undefined` once the engine stops answering, and rejects with an aborted signal's reason.
 */
export function liveFactsReaderContract(harness: LiveFactsReaderHarness): readonly ContractCheck[] {
  return [
    {
      name: "reads the agent's live facts",
      run: async () => {
        const { reader, agent } = await harness.create();
        assert.equal((await reader.read(live()))?.agent, agent);
      },
    },
    {
      name: "answers none when the engine does not answer, and rejects once the signal aborted",
      run: async () => {
        const { reader, goDown } = await harness.create();
        goDown();
        assert.equal(await reader.read(live()), undefined);
        await assert.rejects(reader.read(AbortSignal.abort(new Error("stopped"))), /stopped/u);
      },
    },
  ];
}
