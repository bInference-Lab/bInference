import { describe, expect, it } from "vitest";
import type { JsonValue } from "./json-value.schema.js";
import { editJson5Text } from "./json5-edit.js";
import type { ConfigEdit } from "./migrations/config-edit.js";

// A config file as binference init writes it, then edited by hand: comments over keys and at
// the ends of lines, a block comment, a trailing comma here and none there, single quotes.
const golden = `// The binference config file (docs/specs/config.md), written by binference init.
// Secrets are named by their sources, never written here. binference check validates it.
{
  // The config file's shape.
  version: 1,
  /* The owner: language and time zone. */
  owner: {
    // The owner's language.
    locale: "en", // English for now
    timezone: 'Europe/Berlin',
  },
  engine: { port: 7456, shutdownBudgetMs: 10000 },
  telegram: {
    // The bot's token, from the keychain.
    botToken: { fromKeychain: "telegram-bot" },
    groups: ["-100123"]
  },
  "logging": { level: "info" },
}
`;

function set(path: readonly string[], value: JsonValue): ConfigEdit {
  return { kind: "set", path, value };
}

describe("editJson5Text on a commented file", () => {
  it("changes one value in place and nothing else", () => {
    expect(editJson5Text(golden, [set(["engine", "port"], 7460)])).toBe(
      golden.replace("port: 7456", "port: 7460"),
    );
  });

  it("changes a value with a comment at the end of its line and keeps the comment", () => {
    expect(editJson5Text(golden, [set(["owner", "locale"], "zh")])).toBe(
      golden.replace('locale: "en", // English for now', 'locale: "zh", // English for now'),
    );
  });

  it("replaces a value in single quotes, and a quoted key's value, in double quotes", () => {
    const edited = editJson5Text(golden, [
      set(["owner", "timezone"], "Asia/Shanghai"),
      set(["logging", "level"], "debug"),
    ]);
    expect(edited).toBe(
      golden
        .replace("timezone: 'Europe/Berlin'", 'timezone: "Asia/Shanghai"')
        .replace('level: "info"', 'level: "debug"'),
    );
  });

  it("replaces a secret source whole, on its line", () => {
    const edited = editJson5Text(golden, [
      set(["telegram", "botToken"], { fromEnv: "TELEGRAM_BOT_TOKEN" }),
    ]);
    expect(edited).toBe(
      golden.replace(
        'botToken: { fromKeychain: "telegram-bot" }',
        'botToken: { fromEnv: "TELEGRAM_BOT_TOKEN" }',
      ),
    );
  });

  it("replaces an array whole", () => {
    expect(editJson5Text(golden, [set(["telegram", "groups"], ["-100123", "-100456"])])).toBe(
      golden.replace('groups: ["-100123"]', 'groups: ["-100123", "-100456"]'),
    );
  });

  it("adds a missing key first in its object, indented as the first key, with the comment kept", () => {
    expect(editJson5Text(golden, [set(["telegram", "topics"], true)])).toBe(
      golden.replace("  telegram: {\n", "  telegram: {\n    topics: true,\n"),
    );
  });

  it("adds a missing group as one line at the top of the file's object", () => {
    expect(editJson5Text(golden, [set(["backups", "daily"], false)])).toBe(
      golden.replace(
        "{\n  // The config file's shape.",
        "{\n  backups: { daily: false },\n  // The config file's shape.",
      ),
    );
  });

  it("adds a key to an object written on one line, on that line", () => {
    expect(editJson5Text(golden, [set(["engine", "host"], "127.0.0.1")])).toBe(
      golden.replace("engine: { port: 7456,", 'engine: { host: "127.0.0.1", port: 7456,'),
    );
  });

  it("removes a key's own line with the comment at its end, and keeps the comment above it", () => {
    expect(editJson5Text(golden, [{ kind: "remove", path: ["owner", "locale"] }])).toBe(
      golden.replace('    locale: "en", // English for now\n', ""),
    );
  });

  it("removes a key that shares its line, and a last key with no comma after it", () => {
    const edited = editJson5Text(golden, [
      { kind: "remove", path: ["engine", "shutdownBudgetMs"] },
      { kind: "remove", path: ["telegram", "groups"] },
    ]);
    expect(edited).toBe(
      golden.replace(", shutdownBudgetMs: 10000 }", ", }").replace('    groups: ["-100123"]\n', ""),
    );
  });

  it("removes nothing for a key that is not there", () => {
    expect(editJson5Text(golden, [{ kind: "remove", path: ["owner", "nickname"] }])).toBe(golden);
  });
});

describe("editJson5Text on other texts", () => {
  it("reads quoted keys, single quotes, and text that looks like JSON5 inside strings", () => {
    const quoted = `{ "note": "a } { // not a comment", 'owner': { 'locale': 'en', }, }`;
    expect(editJson5Text(quoted, [set(["owner", "locale"], "zh")])).toBe(
      `{ "note": "a } { // not a comment", 'owner': { 'locale': "zh", }, }`,
    );
  });

  it("keeps the file's line endings", () => {
    const crlf = `{\r\n  version: 1,\r\n  engine: { port: 7456 },\r\n}\r\n`;
    expect(editJson5Text(crlf, [set(["owner", "locale"], "zh")])).toBe(
      `{\r\n  owner: { locale: "zh" },\r\n  version: 1,\r\n  engine: { port: 7456 },\r\n}\r\n`,
    );
    expect(editJson5Text(crlf, [{ kind: "remove", path: ["engine"] }])).toBe(
      `{\r\n  version: 1,\r\n}\r\n`,
    );
  });

  it("fills an empty object on its line", () => {
    expect(editJson5Text("{}", [set(["owner", "locale"], "zh")])).toBe(
      `{ owner: { locale: "zh" } }`,
    );
  });

  it("sets the last of two keys of one name, which JSON5 reads", () => {
    const twice = `{ owner: { locale: "en", locale: "en" }, list: [1, [2], { a: 3 }] }`;
    expect(editJson5Text(twice, [set(["owner", "locale"], "zh")])).toBe(
      `{ owner: { locale: "en", locale: "zh" }, list: [1, [2], { a: 3 }] }`,
    );
  });

  it.each([
    ["text that is no JSON5", "{ owner: ", [set(["owner", "locale"], "zh")]],
    ["a file that is not one object", "[1, 2]", [set(["owner", "locale"], "zh")]],
    [
      "a path through a value that is not an object",
      "{ owner: null }",
      [set(["owner", "locale"], "zh")],
    ],
    ["an unclosed comment", "{ /* owner: { locale: 'en' } }", [set(["owner", "locale"], "zh")]],
    ["a move", "{ a: 1 }", [{ kind: "move", from: ["a"], to: ["b"] }]],
    [
      "a removal that would leave a key of the same name",
      "{ a: 1, a: 2 }",
      [{ kind: "remove", path: ["a"] }],
    ],
  ] as const)("writes nothing for %s", (_name, text, edits) => {
    expect(editJson5Text(text, edits)).toBeUndefined();
  });
});
