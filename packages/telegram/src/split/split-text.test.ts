import { describe, expect, it } from "vitest";
import { maxMessageLength, splitText } from "./split-text.js";

describe("a long text split into Telegram messages", () => {
  it("keeps a text that fits as one message", () => {
    expect(splitText("one\ntwo")).toStrictEqual(["one\ntwo"]);
  });

  it("splits at line breaks, each message as full as the limit allows", () => {
    expect(splitText("aaaa\nbbb\ncc\nd", 8)).toStrictEqual(["aaaa\nbbb", "cc\nd"]);
  });

  it("fills a message of 4,096 characters and starts the next at a line", () => {
    const line = "x".repeat(2047);
    const messages = splitText([line, line, "y"].join("\n"));
    expect(messages.map((message) => message.length)).toStrictEqual([maxMessageLength - 1, 1]);
  });

  it("cuts a line longer than a message, never between the halves of a surrogate pair", () => {
    const icon = String.fromCodePoint(0x1f534);
    expect(splitText(`ab${icon}cd`, 3)).toStrictEqual(["ab", `${icon}c`, "d"]);
  });

  it("keeps an empty line between paragraphs", () => {
    expect(splitText("a\n\nb", 10)).toStrictEqual(["a\n\nb"]);
  });
});
