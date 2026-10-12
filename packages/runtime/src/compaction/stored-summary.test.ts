import { describe, expect, it } from "vitest";
import type { ModelMessage } from "../loop/model-message.js";
import { summaryMessage } from "../sessions/conversation.js";
import { startChatRig } from "../testing/chat-rig.js";
import {
  createScriptedTransport,
  createTestChain,
  textReply,
} from "../testing/scripted-transport.js";

// 8,000 characters: 2,000 tokens a message.
const long = (lead: string): string => `${lead} ${"x".repeat(8_000 - lead.length - 1)}`;

// How each message of a request opens: a result has no text of its own to show.
function openings(messages: readonly ModelMessage[] | undefined): readonly string[] {
  return (messages ?? []).map((message) =>
    message.role === "tool" ? "" : message.text.slice(0, 5),
  );
}

describe("a stored summary", () => {
  it("is stored when the history grows too long, opens the next turn's history, and is taken into the next summary", async () => {
    const summary = "The owner wrote once; nothing was traded.";
    const again = "The owner wrote twice; nothing was traded.";
    const summarizer = createScriptedTransport([textReply(summary), textReply(again)]);
    const rig = await startChatRig({
      replies: [textReply("ok"), textReply("ok"), textReply("ok"), textReply("ok")],
      compaction: (clock) => ({
        summarizer: createTestChain([{ name: "test/fast", transport: summarizer }], { clock }),
        contextTokens: 12_000,
        locale: "en",
      }),
    });
    const { session } = await rig.post(long("one"));
    await rig.runner.rested();
    for (const text of ["two", "three", "four"]) {
      // oxlint-disable-next-line eslint/no-await-in-loop -- one turn after the other
      await rig.post(long(text));
      // oxlint-disable-next-line eslint/no-await-in-loop -- one turn after the other
      await rig.runner.rested();
    }
    expect(summarizer.requests).toHaveLength(2);
    expect(JSON.stringify(summarizer.requests[1]?.messages)).toContain(summary);
    const query = { sessionId: session, limit: 100 };
    const stored = await rig.stores.transcript.events(query, {
      signal: new AbortController().signal,
    });
    expect(stored.filter((event) => event.kind === "summary")).toMatchObject([
      { role: "system", content: { text: summary, fromSeq: 1, throughSeq: 2 }, outside: false },
      { role: "system", content: { text: again, fromSeq: 1, throughSeq: 4 }, outside: false },
    ]);
    const third = rig.transport.requests[2]?.messages;
    const fourth = rig.transport.requests[3]?.messages;
    expect(third?.[0]).toStrictEqual(summaryMessage(summary));
    expect(openings(third?.slice(1))).toStrictEqual(["two x", "ok", "three"]);
    expect(fourth?.[0]).toStrictEqual(summaryMessage(again));
    expect(openings(fourth?.slice(1))).toStrictEqual(["three", "ok", "four "]);
  });
});
