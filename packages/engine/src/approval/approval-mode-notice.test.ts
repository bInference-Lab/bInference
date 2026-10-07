import { createFormatter } from "@binference/i18n";
import { describe, expect, it } from "vitest";
import { approvalModeNoticeKey } from "./approval-mode-notice.js";

const english = createFormatter({ locale: "en", timeZone: "UTC" });

function say(mode: string, surface: string): string {
  return english.message(approvalModeNoticeKey, { agent: "main", mode, surface });
}

describe("the approval mode notice", () => {
  it("names the agent, its new mode and the surface it was switched on", () => {
    expect([say("auto", "mini"), say("manual", "telegram"), say("manual", "cli")]).toStrictEqual([
      "main is now in auto mode, from the Mini App",
      "main is now in manual mode, from Telegram",
      "main is now in manual mode, from the CLI",
    ]);
  });
});
