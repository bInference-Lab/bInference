import { describe, expect, it } from "vitest";
import { unwrapArguments } from "./unwrap-arguments.js";

describe("unwrapArguments", () => {
  it("takes a json string's object one level down only", () => {
    const twice = JSON.stringify(JSON.stringify('{"a":1}'));
    expect(unwrapArguments(twice)).toBeUndefined();
  });

  it.each([
    { why: "two fences", text: '```\n{"a":1}\n```\n```\n{"b":2}\n```' },
    { why: "words past 64 characters", text: `${"a ".repeat(33)}{"a":1}` },
    { why: "no object", text: "a: 1" },
    { why: "a bracket in the words", text: 'see [docs] {"a":1}' },
    { why: "a mark outside the few it takes", text: '{"a":1} €' },
  ])("answers no object for $why", ({ text }) => {
    expect(unwrapArguments(text)).toBeUndefined();
  });

  it.each([
    { why: "a label of capitals", text: '```JSON\n{"a":1}\n```' },
    { why: "a label with space after it", text: '```json \r\n{"a":1}\n```' },
    { why: "no label, the object on the fence's line", text: '```{"a":1}```' },
    { why: "no label, a line break first", text: '```\n\n{"a":1}```' },
  ])("takes the object out of a fence with $why", ({ text }) => {
    expect(unwrapArguments(text)).toStrictEqual({ text: '{"a":1}', steps: ["fence"] });
  });

  it.each([
    { why: "a label of digits", text: '```0x5c95 {"a":"x"}```' },
    { why: "a label of a number", text: '```1000000000000000000\n{"amount":"1"}\n```' },
    { why: "a label with a digit", text: '```json5\n{"a":1}\n```' },
    { why: "a label on the object's line", text: '```json {"a":1}```' },
    { why: "a label of words", text: '```json example\n{"a":1}\n```' },
    { why: "a label with a mark", text: '```tool-call\n{"a":1}\n```' },
  ])("answers no object for a fence opened with $why", ({ text }) => {
    expect(unwrapArguments(text)).toBeUndefined();
  });

  it("takes words of another script around the object", () => {
    expect(unwrapArguments('Παράμετροι: {"a":1}')).toStrictEqual({
      text: '{"a":1}',
      steps: ["words_around"],
    });
  });

  it("runs an object left open to the text's end", () => {
    expect(unwrapArguments('args: {"a":"x"')).toStrictEqual({
      text: '{"a":"x"',
      steps: ["words_around"],
    });
  });
});
