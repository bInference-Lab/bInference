import { createFormatter } from "@binference/i18n";
import { describe, expect, it } from "vitest";
import { webhookPortTakenNotice, webhookPortTakenNoticeKey } from "./webhook-port-notice.js";

const warning = String.fromCodePoint(0x26a0, 0xfe0f);

describe("the notice that the webhook port was taken", () => {
  it("reaches every reading client on the notice topic, naming the port and no agent", () => {
    expect(webhookPortTakenNotice(7457)).toStrictEqual({
      topic: "notice",
      kind: "notice/new",
      data: { key: "notice.webhookPortTaken", values: { port: "7457" } },
    });
  });

  it("names the port and the setting that changes it", () => {
    const english = createFormatter({ locale: "en", timeZone: "UTC" });
    expect(english.message(webhookPortTakenNoticeKey, { port: "17457" })).toBe(
      `${warning} binference cannot take alerts for your alert rules: port 17457 is in use. Set \`engine.webhookPort\` in config.json5 to a free port, then restart binference.`,
    );
  });
});
