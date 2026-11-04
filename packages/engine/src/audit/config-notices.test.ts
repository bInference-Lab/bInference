import { createFormatter } from "@binference/i18n";
import { describe, expect, it } from "vitest";
import { configChangedNotice, configInvalidNotice } from "./config-notices.js";

const english = createFormatter({ locale: "en", timeZone: "UTC" });
const warning = String.fromCodePoint(0x26a0, 0xfe0f);

function wordsOf(push: ReturnType<typeof configChangedNotice>, formatter: typeof english): string {
  const data = push.data as { readonly key: string; readonly values: Record<string, string> };
  return formatter.message(data.key, data.values);
}

describe("the config reload notices", () => {
  it("list the changed keys, and those that wait for a restart", () => {
    const now = configChangedNotice({ keys: ["logging.level"], afterRestart: [] });
    expect(now.data).toStrictEqual({
      key: "notice.configChanged",
      values: { changed: "logging.level", afterRestart: "none", proxy: "none" },
    });
    expect(wordsOf(now, english)).toBe(
      "Settings changed in config.json5: logging.level. They apply now.",
    );
    const later = configChangedNotice({
      keys: ["engine.port", "logging.level"],
      afterRestart: ["engine.port"],
    });
    expect(wordsOf(later, english)).toBe(
      "Settings changed in config.json5: engine.port, logging.level. These apply after binference restarts: engine.port. The rest apply now.",
    );
  });

  it.each([
    ["held", "The proxy in config.json5 cannot be read, so every request it would carry is held."],
    ["auth", "The proxy asked for a user name and password, or refused them."],
    ["refused", "The proxy refused to reach Telegram."],
    ["unreachable", "No connection to the proxy opened."],
    ["noAnswer", "The proxy took a request, but no answer came through it."],
  ] as const)("say how a changed proxy failed its first use: %s", (proxy, words) => {
    const notice = configChangedNotice({ keys: ["network.proxy"], afterRestart: [], proxy });
    expect(wordsOf(notice, english)).toBe(
      `Settings changed in config.json5: network.proxy. They apply now. ${words} Run binference check.`,
    );
  });

  it("name the problem of a file the engine refused, by its line or its key", () => {
    const unreadable = configInvalidNotice({ problem: "unreadable", key: "", line: "12" });
    expect(wordsOf(unreadable, english)).toBe(
      `${warning} binference kept the settings it runs on: config.json5 cannot be read at line 12. Run \`binference check\` to see the fix.`,
    );
    const badValue = configInvalidNotice({ problem: "bad_value", key: "engine.port", line: "" });
    expect(wordsOf(badValue, english)).toBe(
      `${warning} binference kept the settings it runs on: config.json5 has a value engine.port does not take. Run \`binference check\` to see the fix.`,
    );
  });
});
