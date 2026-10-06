import { describe, expect, it } from "vitest";
import { checkCatalogs } from "./check-catalogs.js";
import type { MessageFiles } from "./message-files.js";

const source = {
  reason: { daily_cap: "over your cap ({used} of {cap} used)", frozen: "the agent is frozen" },
  error: { "engine.locked": "binference is locked" },
};

function withTarget(target: MessageFiles[string]): MessageFiles {
  return { en: source, zh: target };
}

describe("checkCatalogs", () => {
  it("passes a translation with every file, key and argument", () => {
    const target = {
      reason: { daily_cap: "cap ({used}, {cap})", frozen: "frozen" },
      error: { "engine.locked": "locked" },
    };
    expect(checkCatalogs(withTarget(target), "en")).toStrictEqual([]);
  });

  it("names a key missing in the translation", () => {
    const target = { reason: { daily_cap: "cap ({used}, {cap})" }, error: source.error };
    expect(checkCatalogs(withTarget(target), "en")).toStrictEqual([
      {
        locale: "zh",
        area: "reason",
        key: "frozen",
        text: "The key is missing; translate the source message.",
      },
    ]);
  });

  it("names a key the source does not have", () => {
    const target = { ...source, error: { ...source.error, "engine.gone": "gone" } };
    expect(checkCatalogs(withTarget(target), "en")).toStrictEqual([
      {
        locale: "zh",
        area: "error",
        key: "engine.gone",
        text: "The source has no such key; add it there first.",
      },
    ]);
  });

  it("names a missing area file and an extra one", () => {
    const target = { reason: source.reason, card: { header: "header" } };
    expect(checkCatalogs(withTarget(target), "en")).toStrictEqual([
      {
        locale: "zh",
        area: "error",
        text: "The file is missing; add it with every key of the source.",
      },
      { locale: "zh", area: "card", text: "The source has no such file; add it there first." },
    ]);
  });

  it("names an argument renamed in the translation", () => {
    const target = { ...source, reason: { ...source.reason, daily_cap: "({used}, {limit})" } };
    expect(checkCatalogs(withTarget(target), "en")).toStrictEqual([
      {
        locale: "zh",
        area: "reason",
        key: "daily_cap",
        text: "The arguments are {limit} {used}, but the source has {cap} {used}; use the same.",
      },
    ]);
  });

  it("names an argument whose kind changes and one a translation drops", () => {
    const target = {
      ...source,
      reason: { daily_cap: "{used, number} {cap}", frozen: "frozen {agent}" },
    };
    const keys = checkCatalogs(withTarget(target), "en").map((item) => item.key);
    expect(keys).toStrictEqual(["daily_cap", "frozen"]);
  });

  it("names a message that does not parse, in any language, once", () => {
    const target = { ...source, reason: { ...source.reason, frozen: "frozen {agent" } };
    expect(checkCatalogs(withTarget(target), "en")).toStrictEqual([
      {
        locale: "zh",
        area: "reason",
        key: "frozen",
        text: "The ICU message does not parse: EXPECT_ARGUMENT_CLOSING_BRACE.",
      },
    ]);
  });

  it("names a missing source language", () => {
    expect(checkCatalogs({ zh: source }, "en")).toStrictEqual([
      { locale: "en", area: "*", text: "The source language has no messages." },
    ]);
  });
});
