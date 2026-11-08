import { describe, expect, it } from "vitest";
import { turnJournalContract } from "../contracts/turn-journal-contract.js";
import type { TurnJournal } from "../loop/ports.js";
import { recordedJournal } from "../testing/recorded-views.js";
import { createTurnRecorder } from "../testing/turn-recorder.js";
import { hiddenToolArgs } from "../tools/agent-tools.js";
import { withHiddenArgs } from "./hidden-args.js";

const signal = new AbortController().signal;
const done = async () => Promise.resolve();

// A journal that keeps what each write was handed.
function spyJournal(written: unknown[]): TurnJournal {
  const keep = async (value: unknown) => {
    written.push(value);
    return Promise.resolve();
  };
  return {
    response: keep,
    toolCall: keep,
    proposal: keep,
    toolResult: done,
    joined: done,
    summary: done,
    described: done,
    markOutside: done,
    end: done,
  };
}

const readCall = {
  id: "c1",
  name: "read_pdf",
  argumentsText: '{"pdf":"~/statement.pdf","password":"s3cret"}',
};

describe("a journal that hides arguments", () => {
  it.each(
    turnJournalContract({
      create: async () => {
        const recorder = createTurnRecorder();
        return {
          journal: withHiddenArgs(recorder.journal, hiddenToolArgs),
          read: async () => recordedJournal(recorder.steps),
        };
      },
    }),
  )("keeps the journal contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });

  it("writes a PDF's password as hidden in the call, and keeps every other argument", async () => {
    const written: unknown[] = [];
    await withHiddenArgs(spyJournal(written), hiddenToolArgs).toolCall(readCall, signal);
    expect(written).toStrictEqual([
      { ...readCall, argumentsText: '{"pdf":"~/statement.pdf","password":"(hidden)"}' },
    ]);
  });

  it("hides it in a response's replay too, and leaves other tools' calls as they are", async () => {
    const written: unknown[] = [];
    const journal = withHiddenArgs(spyJournal(written), hiddenToolArgs);
    const content = [
      { type: "tool_use", id: "c1", name: "read_pdf", input: { pdf: "a.pdf", password: "s3cret" } },
      { type: "tool_use", id: "c2", name: "file_read", input: { path: "password.txt" } },
    ];
    await journal.response(
      { text: "", reasoning: "", replay: { format: "messages", content } },
      signal,
    );
    await journal.toolCall({ id: "c3", name: "file_read", argumentsText: "{not json" }, signal);
    expect(JSON.stringify(written)).not.toContain("s3cret");
    expect(written).toMatchObject([
      {
        replay: {
          content: [
            { name: "read_pdf", input: { pdf: "a.pdf", password: "(hidden)" } },
            { name: "file_read", input: { path: "password.txt" } },
          ],
        },
      },
      { argumentsText: "{not json" },
    ]);
  });

  it("drops arguments it cannot read whole, and a replay it cannot read", async () => {
    const written: unknown[] = [];
    const journal = withHiddenArgs(spyJournal(written), hiddenToolArgs);
    await journal.toolCall({ ...readCall, argumentsText: '{"password":"s3cret"' }, signal);
    const replay = { format: "messages" as const, content: [{ type: "other", name: "read_pdf" }] };
    await journal.response({ text: "Reading.", reasoning: "", replay }, signal);
    expect(written).toStrictEqual([
      { ...readCall, argumentsText: "{}" },
      { text: "Reading.", reasoning: "" },
    ]);
  });
});
