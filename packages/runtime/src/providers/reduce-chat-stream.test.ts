import { describe, expect, it } from "vitest";
import type { ModelEvent } from "../loop/model-event.js";
import { reduceChatStream } from "./reduce-chat-stream.js";

async function* chunksOf(deltas: readonly object[]): AsyncGenerator<object> {
  for (const delta of deltas) {
    yield { id: "call", choices: [{ index: 0, delta }] };
  }
  yield { id: "call", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] };
}

async function reasoningOf(deltas: readonly object[]): Promise<readonly string[]> {
  const events: ModelEvent[] = [];
  for await (const event of reduceChatStream(chunksOf(deltas), new AbortController().signal)) {
    events.push(event);
  }
  return events.flatMap((event) => (event.type === "reasoning" ? [event.delta] : []));
}

describe("reduceChatStream", () => {
  it.each([
    { field: "reasoning_content", delta: { reasoning_content: "A" } },
    { field: "reasoning", delta: { reasoning: "A" } },
    { field: "reasoning_text", delta: { reasoning_text: "A" } },
  ])("reads the reasoning a gateway sends as $field", async ({ delta }) => {
    expect(await reasoningOf([delta])).toStrictEqual(["A"]);
  });

  it("reads structured reasoning text items first and leaves the other fields", async () => {
    const delta = {
      reasoning: "the same words again",
      reasoning_details: [
        { type: "reasoning.text", text: "Check " },
        { type: "reasoning.encrypted", data: "opaque" },
        { type: "reasoning.text", text: "the pool." },
        "not an item",
      ],
    };
    expect(await reasoningOf([delta])).toStrictEqual(["Check the pool."]);
  });

  it("takes the first reasoning field that holds text", async () => {
    const delta = { reasoning_content: "", reasoning: "B", reasoning_text: "C" };
    expect(await reasoningOf([delta])).toStrictEqual(["B"]);
  });
});
