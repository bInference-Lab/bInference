import { createManualClock } from "@binference/core/testing";
import { describe, expect, it } from "vitest";
import type { ModelEvent } from "./model-event.js";
import { readModelResponse } from "./read-model-response.js";

const usage = { inputTokens: 3, outputTokens: 2, cachedTokens: 0 };

async function* events(list: readonly ModelEvent[]): AsyncGenerator<ModelEvent> {
  yield* list;
}

async function* broken(): AsyncGenerator<ModelEvent> {
  yield { type: "text", delta: "Hi" };
  throw new Error("socket closed");
}

const clock = createManualClock();

async function read(list: readonly ModelEvent[], signal = new AbortController().signal) {
  return readModelResponse(events(list), { signal, clock });
}

describe("readModelResponse", () => {
  it("joins text, reasoning and each call's argument pieces in the calls' order", async () => {
    const response = await read([
      { type: "reasoning", delta: "Check the " },
      { type: "toolCallStart", index: 1, id: "b", name: "chart" },
      { type: "toolCallStart", index: 0, id: "a", name: "quote" },
      { type: "toolCallDelta", index: 0, delta: '{"token":' },
      { type: "toolCallDelta", index: 1, delta: "{}" },
      { type: "toolCallDelta", index: 0, delta: '"CAKE"}' },
      { type: "text", delta: "Looking" },
      { type: "toolCallEnd", index: 1 },
      { type: "reasoning", delta: "price." },
      { type: "toolCallEnd", index: 0 },
      { type: "text", delta: " now." },
      { type: "done", stop: "tool_calls", usage },
    ]);
    expect(response).toStrictEqual({
      ok: true,
      text: "Looking now.",
      reasoning: "Check the price.",
      toolCalls: [
        { id: "a", name: "quote", argumentsText: '{"token":"CAKE"}' },
        { id: "b", name: "chart", argumentsText: "{}" },
      ],
      stop: "tool_calls",
      usage,
    });
  });

  it("keeps what the model wrote before a failure", async () => {
    const response = await read([
      { type: "text", delta: "Half an" },
      { type: "error", failure: "transient", message: "503" },
      { type: "text", delta: " answer" },
    ]);
    expect(response).toStrictEqual({
      ok: false,
      failure: "transient",
      message: "503",
      text: "Half an",
      reasoning: "",
    });
  });

  it("calls a stream with no last event a transient failure", async () => {
    const response = await read([{ type: "text", delta: "Hi" }]);
    expect(response).toMatchObject({ ok: false, failure: "transient", text: "Hi" });
  });

  it.each([
    ["a delta for a call that never started", [{ type: "toolCallDelta", index: 0, delta: "{}" }]],
    [
      "a call started twice",
      [
        { type: "toolCallStart", index: 0, id: "a", name: "quote" },
        { type: "toolCallStart", index: 0, id: "b", name: "chart" },
      ],
    ],
    [
      "a delta after the call ended",
      [
        { type: "toolCallStart", index: 0, id: "a", name: "quote" },
        { type: "toolCallEnd", index: 0 },
        { type: "toolCallDelta", index: 0, delta: "{}" },
      ],
    ],
    [
      "a finished response with a call still open",
      [
        { type: "toolCallStart", index: 0, id: "a", name: "quote" },
        { type: "done", stop: "tool_calls", usage },
      ],
    ],
  ] satisfies [string, ModelEvent[]][])(
    "refuses a stream out of order: %s",
    async (_case, list) => {
      await expect(read(list)).resolves.toMatchObject({ ok: false, failure: "transient" });
    },
  );

  it("keeps an open call of a response cut off at its output limit", async () => {
    const response = await read([
      { type: "toolCallStart", index: 0, id: "a", name: "quote" },
      { type: "toolCallDelta", index: 0, delta: '{"tok' },
      { type: "done", stop: "length", usage },
    ]);
    expect(response).toMatchObject({
      ok: true,
      stop: "length",
      toolCalls: [{ id: "a", name: "quote", argumentsText: '{"tok' }],
    });
  });

  it("calls a stream that throws a transient failure", async () => {
    const response = await readModelResponse(broken(), {
      signal: new AbortController().signal,
      clock,
    });
    expect(response).toMatchObject({ ok: false, failure: "transient", text: "Hi" });
  });

  it("calls a response read after its signal aborted an aborted failure", async () => {
    const controller = new AbortController();
    controller.abort("owner");
    const response = await read(
      [
        { type: "text", delta: "Hi" },
        { type: "done", stop: "end", usage },
      ],
      controller.signal,
    );
    expect(response).toMatchObject({ ok: false, failure: "aborted", text: "Hi" });
  });
});
