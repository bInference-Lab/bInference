import { createFormatter } from "@binference/i18n";
import { describe, expect, it } from "vitest";
import { configChangedNotice, configInvalidNotice } from "./config-notices.js";

const chinese = createFormatter({ locale: "zh", timeZone: "UTC" });
const warning = String.fromCodePoint(0x26a0, 0xfe0f);

function wordsOf(push: ReturnType<typeof configChangedNotice>): string {
  const data = push.data as { readonly key: string; readonly values: Record<string, string> };
  return chinese.message(data.key, data.values);
}

describe("the config reload notices in Chinese", () => {
  it("list the changed keys, and those that wait for a restart", () => {
    const later = configChangedNotice({
      keys: ["engine.port", "logging.level"],
      afterRestart: ["engine.port"],
    });
    expect(wordsOf(later)).toBe(
      "config.json5 中的设置已更改：engine.port, logging.level。以下设置在 binference 重启后生效：engine.port。其余已立即生效。",
    );
  });

  it("name the problem of a file the engine refused", () => {
    const badValue = configInvalidNotice({ problem: "bad_value", key: "engine.port", line: "" });
    expect(wordsOf(badValue)).toBe(
      `${warning} binference 保留了当前运行的设置：config.json5 中 engine.port 的值不可用。请运行 \`binference check\` 查看修复方法。`,
    );
  });
});
