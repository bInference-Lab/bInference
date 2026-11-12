import { maxJsonDepth } from "@binference/core";
import { describe, expect, it } from "vitest";
import { channelLines } from "./channel-lines.js";
import { parsePluginLine } from "./plugin-line.schema.js";

async function* chunks(...parts: readonly string[]): AsyncGenerator<Uint8Array> {
  for (const part of parts) {
    yield Buffer.from(part);
  }
}

async function all(input: AsyncIterable<Uint8Array>, maxBytes: number): Promise<string[]> {
  const lines: string[] = [];
  for await (const line of channelLines(input, maxBytes)) {
    lines.push(line);
  }
  return lines;
}

describe("channelLines", () => {
  it("cuts lines across chunks and drops an unfinished last line", async () => {
    await expect(all(chunks("ab", "c\nd", "e\n\nf"), 16)).resolves.toStrictEqual(["abc", "de", ""]);
  });

  it("throws as soon as a line is longer than its bound, before its line break", async () => {
    await expect(all(chunks("12345", "6"), 5)).rejects.toMatchObject({
      code: "plugin.message_too_large",
    });
    await expect(all(chunks("123456\n"), 5)).rejects.toMatchObject({
      code: "plugin.message_too_large",
    });
  });

  it("reads multibyte text cut between chunks", async () => {
    const text = Buffer.from("é€\n");
    async function* split(): AsyncGenerator<Uint8Array> {
      yield text.subarray(0, 3);
      yield text.subarray(3);
    }

    await expect(all(split(), 16)).resolves.toStrictEqual(["é€"]);
  });
});

// A result line whose output nests `depth` deep, inside the line's own object.
const output = (depth: number): string =>
  `{"kind":"result","id":"c1","output":${"[".repeat(depth)}${"]".repeat(depth)}}`;

describe("parsePluginLine", () => {
  it("reads no message from a line nested past the bound, and reads one at the bound", () => {
    expect(parsePluginLine(output(maxJsonDepth - 1))).toMatchObject({ kind: "result" });
    expect(parsePluginLine(output(maxJsonDepth))).toBeUndefined();
    expect(parsePluginLine(output(10_000))).toBeUndefined();
  });

  it("reads each message a plugin may send", () => {
    const messages = [
      { kind: "ready", tools: ["fear_index"] },
      { kind: "result", id: "c1", output: { value: 40 } },
      { kind: "failed", id: "c1", code: "plugin.tool_failed" },
      {
        kind: "fetch",
        id: "f1",
        request: { url: "https://a.example.com/", method: "GET", headers: {} },
      },
      { kind: "log", level: "warn", code: "feed.slow" },
    ];

    expect(messages.map((message) => parsePluginLine(JSON.stringify(message)))).toStrictEqual(
      messages,
    );
  });

  it.each([
    ["text that is not JSON", "not json"],
    [
      "a message of the host's",
      JSON.stringify({ kind: "start", entry: "/x", config: null, hosts: [] }),
    ],
    ["a field the message lacks", JSON.stringify({ kind: "ready", tools: [], extra: 1 })],
    [
      "a log code that is text",
      JSON.stringify({ kind: "log", level: "info", code: "Hello world" }),
    ],
    ["a log level of its own", JSON.stringify({ kind: "log", level: "debug", code: "a.b" })],
  ])("refuses %s", (_name, line) => {
    expect(parsePluginLine(line)).toBeUndefined();
  });
});
