import { describe, expect, it } from "vitest";
import { messagesEventOf } from "./messages-event.schema.js";

// An object nested `depth` deep under `x`, built without recursion.
function nestedObject(depth: number): object {
  let value: object = {};
  for (let level = 1; level < depth; level += 1) {
    value = { x: value };
  }
  return value;
}

// A tool use's start, its input as given.
const toolStart = (input: object): object => ({
  type: "content_block_start",
  index: 0,
  content_block: { type: "tool_use", id: "toolu_1", name: "quote", input },
});

describe("a streamed Messages event", () => {
  it("reads a tool use's start nested at the bound", () => {
    expect(messagesEventOf(toolStart(nestedObject(60)))).toMatchObject({
      type: "content_block_start",
    });
  });

  it("reads an event nested past the bound as malformed, before any schema walks it", () => {
    expect(messagesEventOf(toolStart(nestedObject(10_000)))).toBeUndefined();
  });
});
