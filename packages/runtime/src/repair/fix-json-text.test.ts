import { describe, expect, it } from "vitest";
import { fixJsonText } from "./fix-json-text.js";

describe("fixJsonText", () => {
  it.each([
    { text: '{"a":"x"}', fixed: '{"a":"x"}', steps: [] },
    { text: "{'a': 'b\\\\c'}", fixed: '{"a": "b\\\\c"}', steps: ["single_quotes"] },
    { text: "{'a': 'say \\u0041'}", fixed: '{"a": "say \\u0041"}', steps: ["single_quotes"] },
    { text: '{"a":"it\'s, ok",}', fixed: '{"a":"it\'s, ok"}', steps: ["trailing_comma"] },
    { text: '{"a":[true, null ,\n]}', fixed: '{"a":[true, null \n]}', steps: ["trailing_comma"] },
    { text: '{"a":{"b":[false', fixed: '{"a":{"b":[false]}}', steps: ["closed"] },
    { text: '{"a":"}"', fixed: '{"a":"}"}', steps: ["closed"] },
  ])("fixes $text", ({ text, fixed, steps }) => {
    expect(fixJsonText(text)).toStrictEqual({ text: fixed, steps });
  });

  it.each([
    { why: "an object opened last", text: '{"a":{' },
    { why: "a list opened last", text: '{"a":[' },
    { why: "a list cut after a comma", text: '{"a":["x",' },
    { why: "a number last, which may be cut", text: '{"a":-12' },
    { why: "a single-quoted string never closed", text: "{'a': 'x" },
    { why: "a double-quoted string never closed", text: '{"a": "x' },
  ])("answers no fix for $why", ({ text }) => {
    expect(fixJsonText(text)).toBeUndefined();
  });
});
