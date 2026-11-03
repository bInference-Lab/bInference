import { createFormatter } from "@binference/i18n";
import { describe, expect, it } from "vitest";
import { webhookPortTakenNoticeKey } from "./webhook-port-notice.js";

const warning = String.fromCodePoint(0x26a0, 0xfe0f);

describe("the notice that the webhook port was taken, in Chinese", () => {
  it("names the port and the setting that changes it", () => {
    const chinese = createFormatter({ locale: "zh", timeZone: "UTC" });
    expect(chinese.message(webhookPortTakenNoticeKey, { port: "17457" })).toBe(
      `${warning} binference 无法为提醒规则接收提醒：端口 17457 已被占用。请在 config.json5 中把 \`engine.webhookPort\` 设为空闲端口，然后重启 binference。`,
    );
  });
});
