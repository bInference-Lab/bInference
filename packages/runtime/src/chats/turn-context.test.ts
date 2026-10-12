import type { Clock } from "@binference/core";
import { describe, expect, it } from "vitest";
import type { ModelTransport } from "../loop/ports.js";
import { createChatCompletionsTransport } from "../providers/chat-completions-transport.js";
import { createMessagesTransport } from "../providers/messages-transport.js";
import type { StreamingHttp } from "../providers/ports.js";
import { startChatRig } from "../testing/chat-rig.js";
import { nthTestId } from "../testing/memory-agent-stores.js";
import { createMemoryContextSource } from "../testing/memory-context-source.js";
import { textStream } from "../testing/recorded-chat-streams.js";
import { createRecordedHttp, type RecordedAnswer } from "../testing/recorded-http.js";
import { messagesTextStream } from "../testing/recorded-messages-streams.js";
import { createTestChain } from "../testing/scripted-transport.js";

const agent = nthTestId("agt", 1);
const facts = /Live facts from binference/u;

interface Wire {
  readonly system?: unknown;
  readonly tools?: unknown;
  readonly messages: readonly { readonly role: string; readonly content: unknown }[];
}

/** How each transport writes the parts of a call, read back from the request it sent. */
interface Transport {
  readonly make: (http: StreamingHttp, clock: Clock) => ModelTransport;
  readonly answer: RecordedAnswer;
  /** The stable prefix as the request carries it: its system part and its tools. */
  readonly prefix: (wire: Wire) => string;
  /** The texts of the request's last two user parts: the history's end, then the tail. */
  readonly lastTwo: (wire: Wire) => readonly unknown[];
}

const options = { apiKey: "sk-test", timeoutMs: 120_000 };

// A request's JSON body as the provider would read it.
function wireOf(body: string | undefined): Wire {
  return JSON.parse(body ?? "{}") as Wire;
}

const transports: Readonly<Record<string, Transport>> = {
  "Chat Completions": {
    make: (http, clock) =>
      createChatCompletionsTransport({
        ...options,
        baseUrl: "https://models.example.test/v1",
        model: "anthropic/claude-sonnet-4.5",
        http,
        clock,
      }),
    answer: textStream,
    prefix: (wire) => JSON.stringify([wire.messages[0], wire.tools]),
    lastTwo: (wire) => wire.messages.slice(-2).map((message) => message.content),
  },
  Messages: {
    make: (http, clock) =>
      createMessagesTransport({
        ...options,
        baseUrl: "https://models.example.test",
        model: "claude-sonnet-5-5",
        http,
        clock,
      }),
    answer: messagesTextStream,
    prefix: (wire) => JSON.stringify([wire.system, wire.tools]),
    lastTwo: (wire) =>
      (wire.messages.at(-1) as { readonly content: readonly unknown[] }).content.slice(-2),
  },
};

describe.each(Object.entries(transports))("each turn's context on %s", (_name, transport) => {
  it("sends the same prefix bytes while nothing changes, the facts after the history, and an edit at the next turn", async () => {
    const http = createRecordedHttp([transport.answer, transport.answer, transport.answer]);
    const context = createMemoryContextSource();
    context.write(agent, "RULES.md", "Rule one.");
    const rig = await startChatRig({
      replies: [],
      tools: [{ name: "portfolio", kind: "read" }],
      context,
      models: (clock) =>
        createTestChain([{ name: "test/model", transport: transport.make(http, clock) }], {
          clock,
        }),
    });
    for (const text of ["first", "second"]) {
      // oxlint-disable-next-line eslint/no-await-in-loop -- one turn after the other
      await rig.post(text);
      // oxlint-disable-next-line eslint/no-await-in-loop -- one turn after the other
      await rig.runner.rested();
      // oxlint-disable-next-line eslint/no-await-in-loop -- the next turn's facts are newer
      await rig.clock.advance(60_000);
    }
    context.write(agent, "RULES.md", "Rule two.");
    await rig.post("third");
    await rig.runner.rested();
    const wires = http.requests.map((request) => wireOf(request.body));
    const [first, second, third] = wires.map(transport.prefix);
    expect(second).toBe(first);
    expect(first).toContain("Rule one.");
    expect(third).toContain("Rule two.");
    expect(third).not.toContain("Rule one.");
    expect(JSON.stringify(wires[1]?.tools)).toContain("portfolio");
    const [one, two] = [wires[0] as Wire, wires[1] as Wire];
    const [end, tail] = transport.lastTwo(two);
    expect(JSON.stringify(end)).toContain("second");
    expect(JSON.stringify(end)).toContain("cache_control");
    expect(JSON.stringify(tail)).toMatch(/Live facts from binference/u);
    expect(JSON.stringify(tail)).not.toContain("cache_control");
    expect(transport.prefix(one)).not.toMatch(facts);
    expect(transport.lastTwo(one)).not.toStrictEqual(transport.lastTwo(two));
  });
});
