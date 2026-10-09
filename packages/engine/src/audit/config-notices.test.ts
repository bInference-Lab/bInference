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
      values: { changed: "logging.level", afterRestart: "none" },
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
