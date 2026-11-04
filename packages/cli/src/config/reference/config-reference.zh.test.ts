import { createFormatter } from "@binference/i18n";
import { describe, expect, it } from "vitest";
import { renderConfigReference } from "./config-reference.js";

const chinese = createFormatter({ locale: "zh", timeZone: "UTC" });

describe("config reference in Chinese", () => {
  it("writes each key's text, what it takes and its default in Chinese", () => {
    const reference = renderConfigReference(chinese);

    expect(reference).toContain(
      "- `engine.port`: 控制台、Mini App 和 WebSocket 使用的端口。" +
        "取值：1024 到 65535 之间的数字。默认：`7456`。变量：`BINFERENCE_ENGINE__PORT`。",
    );
    expect(reference).toContain("默认：跟随操作系统。");
    expect(reference).not.toContain("Variable: ");
  });
});
