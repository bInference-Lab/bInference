import { describe, expect, it } from "vitest";
import { withOwnerLocale } from "./owner-locale-text.js";

const file = `// binference config, written by binference init.
{
  version: 1,
  // Your language and time zone.
  owner: {
    locale: "en", // English
    timezone: "Europe/Berlin",
  },
  engine: { port: 7456 },
}
`;

describe("the owner's language set in the config file", () => {
  it("changes the value in place and keeps every comment and line", () => {
    expect(withOwnerLocale(file, "zh")).toBe(file.replace('locale: "en"', 'locale: "zh"'));
  });

  it("reads quoted keys, single quotes, and text that looks like JSON5 inside strings", () => {
    const quoted = `{ "note": "a } { // not a comment", 'owner': { 'locale': 'en', }, }`;
    expect(withOwnerLocale(quoted, "zh")).toBe(
      `{ "note": "a } { // not a comment", 'owner': { 'locale': "zh", }, }`,
    );
  });

  it("adds the locale at the top of the owner, indented as the owner's first key", () => {
    const noLocale = `{\n  owner: {\n    timezone: "UTC",\n  },\n}\n`;
    expect(withOwnerLocale(noLocale, "zh")).toBe(
      `{\n  owner: {\n    locale: "zh",\n    timezone: "UTC",\n  },\n}\n`,
    );
    expect(withOwnerLocale(`{ owner: {} }`, "en")).toBe(`{ owner: { locale: "en" } }`);
  });

  it("adds the owner at the top of the file when it has none, in the file's line endings", () => {
    const crlf = `{\r\n  version: 1,\r\n}\r\n`;
    expect(withOwnerLocale(crlf, "zh")).toBe(
      `{\r\n  owner: { locale: "zh" },\r\n  version: 1,\r\n}\r\n`,
    );
    expect(withOwnerLocale("{}", "zh")).toBe(`{ owner: { locale: "zh" } }`);
  });

  it("sets the last owner and the last locale, which JSON5 reads", () => {
    const twice = `{ owner: { locale: "en", locale: "en" }, list: [1, [2], { a: 3 }] }`;
    expect(withOwnerLocale(twice, "zh")).toBe(
      `{ owner: { locale: "en", locale: "zh" }, list: [1, [2], { a: 3 }] }`,
    );
  });

  it.each([
    ["text that is no JSON5", "{ owner: "],
    ["a file that is not one object", "[1, 2]"],
    ["an owner that is not an object", "{ owner: null }"],
    ["a locale that is an object", "{ owner: { locale: { a: 1 } } }"],
    ["an unclosed comment", "{ /* owner: { locale: 'en' } }"],
  ])("writes nothing for %s", (_name, text) => {
    expect(withOwnerLocale(text, "zh")).toBeUndefined();
  });
});
