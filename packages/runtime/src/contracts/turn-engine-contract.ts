import assert from "node:assert/strict";
import type { ContractCheck } from "@binference/core/testing";
import type { TurnOutcome } from "@binference/store";
import type { TurnEngine } from "../loop/ports.js";

/** What the engine holds of one turn, as the subject reads it back. */
export interface EngineView {
  /** The messages `turn/start` named and the mark it carried, once the engine started it. */
  readonly started?: { readonly messages: readonly string[]; readonly outside: boolean };
  /** The engine holds the turn as the agent's running turn. */
  readonly running: boolean;
  /** The running turn holds outside content. */
  readonly marked: boolean;
  readonly said: readonly string[];
  /** The status keys of spec 4 the turn sent, in order. */
  readonly statusKeys: readonly string[];
  readonly ended?: TurnOutcome;
}

/** The engine's side of one fresh turn, the messages it takes, and a way to read the engine. */
export interface TurnEngineSubject {
  readonly engine: TurnEngine;
  readonly messages: readonly string[];
  readonly read: () => Promise<EngineView>;
}

/** Makes a fresh subject for each check; `refuse` makes the engine refuse to start the turn. */
export interface TurnEngineHarness {
  create(options: { readonly refuse?: "archived" | "not_found" }): Promise<TurnEngineSubject>;
}

const live = (): AbortSignal => new AbortController().signal;

async function runsATurn(harness: TurnEngineHarness): Promise<void> {
  const { engine, messages, read } = await harness.create({});
  const started = await engine.start({ messages, outsideContent: false }, live());
  assert.equal(started.ok && typeof started.value.budgetLeftMicros, "bigint");
  assert.deepEqual((await read()).started, { messages, outside: false });
  assert.equal((await read()).running, true);
  const usage = { model: "p/m", inputTokens: 10, outputTokens: 2, cachedTokens: 4, usdMicros: 7n };
  const recorded = await engine.recordUsage({ ...usage, key: "u.1" }, live());
  assert.equal(typeof recorded.budgetLeftMicros, "bigint");
  await engine.say("Done.", live());
  await engine.status({ line: "moreProposals", count: 2 }, live());
  await engine.status({ line: "proposalRefused" }, live());
  await engine.status({ line: "failed", failure: "time_limit" }, live());
  await engine.end("ok", live());
  const view = await read();
  assert.deepEqual(view.said, ["Done."]);
  assert.deepEqual(view.statusKeys, [
    "turn.proposalWaits",
    "turn.moreProposals",
    "turn.failed.timeLimit",
  ]);
  assert.equal(view.running, false);
  assert.equal(view.ended, "ok");
}

async function marksTheTurn(harness: TurnEngineHarness): Promise<void> {
  const { engine, messages, read } = await harness.create({});
  await engine.start({ messages, outsideContent: false }, live());
  assert.equal((await read()).marked, false);
  await engine.mark(live());
  assert.equal((await read()).marked, true);
  await engine.end("stopped", live());
}

async function refusesToStart(harness: TurnEngineHarness): Promise<void> {
  for (const refuse of ["archived", "not_found"] as const) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- one fresh subject at a time
    const { engine, messages, read } = await harness.create({ refuse });
    // oxlint-disable-next-line eslint/no-await-in-loop -- one fresh subject at a time
    const started = await engine.start({ messages, outsideContent: false }, live());
    assert.deepEqual(started, { ok: false, error: refuse });
    // oxlint-disable-next-line eslint/no-await-in-loop -- one fresh subject at a time
    assert.equal((await read()).running, false);
  }
}

async function refusesAborted(harness: TurnEngineHarness): Promise<void> {
  const { engine, messages, read } = await harness.create({});
  const stopped = AbortSignal.abort(new Error("the turn stopped"));
  await assert.rejects(engine.start({ messages, outsideContent: false }, stopped));
  assert.equal((await read()).running, false);
}

/**
 * The contract every {@link TurnEngine} keeps (runtime spec, section 4.3): the engine starts the
 * turn and holds it as running until its end, takes its mark and each model call's usage, carries
 * its text and its status lines as spec 4's keys, refuses a turn of an archived or unknown agent,
 * and an aborted signal rejects the call.
 */
export function turnEngineContract(harness: TurnEngineHarness): readonly ContractCheck[] {
  return [
    {
      name: "starts a turn, carries its text and status keys, and ends it",
      run: async () => runsATurn(harness),
    },
    {
      name: "marks the running turn as holding outside content",
      run: async () => marksTheTurn(harness),
    },
    {
      name: "refuses to start a turn of an archived or unknown agent",
      run: async () => refusesToStart(harness),
    },
    {
      name: "rejects a start on an aborted signal and starts nothing",
      run: async () => refusesAborted(harness),
    },
  ];
}
