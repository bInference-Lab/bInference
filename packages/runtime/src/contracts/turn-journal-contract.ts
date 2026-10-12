import assert from "node:assert/strict";
import type { ContractCheck } from "@binference/core/testing";
import type { TurnOutcome } from "@binference/store";
import type { ToolCall } from "../loop/model-message.js";
import type { TurnJournal } from "../loop/ports.js";
import type { SummaryRecord } from "../loop/turn-records.js";

/** One write of a turn's journal, as the subject reads it back. */
export type JournalEntry =
  | { readonly kind: "response"; readonly text: string }
  | { readonly kind: "call"; readonly id: string }
  | { readonly kind: "proposal"; readonly id: string; readonly key: string }
  | {
      readonly kind: "result";
      readonly id: string;
      readonly ran: boolean;
      readonly outside: boolean;
    }
  | { readonly kind: "joined"; readonly ids: readonly string[] }
  | ({ readonly kind: "summary" } & SummaryRecord);

/** What a turn's journal holds: its writes in order, its marks and its end. */
export interface JournalView {
  readonly entries: readonly JournalEntry[];
  readonly committed: boolean;
  readonly outside: boolean;
  readonly end?: { readonly outcome: TurnOutcome; readonly heldBack: number };
}

/** A fresh turn's journal, with a way to read back what it holds. */
export interface TurnJournalSubject {
  readonly journal: TurnJournal;
  readonly read: () => Promise<JournalView>;
}

/** Makes a fresh subject for each check: a turn that started with no write yet. */
export interface TurnJournalHarness {
  create(): Promise<TurnJournalSubject>;
}

const live = (): AbortSignal => new AbortController().signal;
const quote: ToolCall = { id: "call_1", name: "quote", argumentsText: '{"amount":"1"}' };
const swap: ToolCall = { id: "call_2", name: "swap", argumentsText: '{"amount":"2"}' };
const joining = { id: "msg_0190f1c2-3a4b-7c5d-8e6f-000000000002", text: "and BNB", outside: true };

async function keepsEveryWrite(harness: TurnJournalHarness): Promise<void> {
  const { journal, read } = await harness.create();
  await journal.response({ text: "Looking", reasoning: "a quote first" }, live());
  await journal.toolCall(quote, live());
  const result = { callId: quote.id, name: quote.name, text: "1 BNB", isError: false };
  await journal.toolResult({ ...result, outside: true, ran: true }, live());
  await journal.joined([joining], live());
  await journal.markOutside(live());
  await journal.end({ outcome: "ok", heldBack: 0 }, live());
  assert.deepEqual(await read(), {
    entries: [
      { kind: "response", text: "Looking" },
      { kind: "call", id: quote.id },
      { kind: "result", id: quote.id, ran: true, outside: true },
      { kind: "joined", ids: [joining.id] },
    ],
    committed: false,
    outside: true,
    end: { outcome: "ok", heldBack: 0 },
  });
}

async function writesProposalWithMark(harness: TurnJournalHarness): Promise<void> {
  const { journal, read } = await harness.create();
  await journal.response({ text: "Buying", reasoning: "" }, live());
  assert.equal((await read()).committed, false);
  await journal.proposal({ call: swap, idempotencyKey: "turn.1" }, live());
  const view = await read();
  assert.equal(view.committed, true);
  assert.deepEqual(view.entries.at(-1), { kind: "proposal", id: swap.id, key: "turn.1" });
  const result = { callId: swap.id, name: swap.name, text: "waits", isError: false };
  await journal.toolResult({ ...result, outside: false, ran: true }, live());
  await journal.end({ outcome: "ok", heldBack: 1 }, live());
  assert.deepEqual((await read()).end, { outcome: "ok", heldBack: 1 });
}

async function keepsSummary(harness: TurnJournalHarness): Promise<void> {
  const { journal, read } = await harness.create();
  await journal.response({ text: "Looking", reasoning: "" }, live());
  const summary = { text: "The owner bought BNB.", fromSeq: 1, throughSeq: 1, outside: true };
  await journal.summary(summary, live());
  assert.deepEqual((await read()).entries, [
    { kind: "response", text: "Looking" },
    { kind: "summary", ...summary },
  ]);
  await assert.rejects(journal.summary(summary, AbortSignal.abort(new Error("stopped"))));
  assert.equal((await read()).entries.length, 2);
}

async function refusesAborted(harness: TurnJournalHarness): Promise<void> {
  const { journal, read } = await harness.create();
  const stopped = AbortSignal.abort(new Error("the turn stopped"));
  await assert.rejects(journal.toolCall(quote, stopped));
  await assert.rejects(journal.proposal({ call: swap, idempotencyKey: "turn.2" }, stopped));
  const view = await read();
  assert.deepEqual(view.entries, []);
  assert.equal(view.committed, false);
}

/**
 * The contract every {@link TurnJournal} keeps (runtime spec, section 11): it keeps each write in
 * order before it resolves, a summary with its range and its outside mark, stores a proposal with
 * the turn's committed mark, and on an aborted
 * signal rejects and writes nothing.
 */
export function turnJournalContract(harness: TurnJournalHarness): readonly ContractCheck[] {
  return [
    {
      name: "keeps each write in order, with the outside mark and the end",
      run: async () => keepsEveryWrite(harness),
    },
    {
      name: "writes a proposal with the turn's committed mark",
      run: async () => writesProposalWithMark(harness),
    },
    {
      name: "keeps a summary with the range it covers and its outside mark",
      run: async () => keepsSummary(harness),
    },
    {
      name: "rejects a write on an aborted signal and keeps nothing of it",
      run: async () => refusesAborted(harness),
    },
  ];
}
