import { createFormatter } from "@binference/i18n";
import { describe, expect, it } from "vitest";
import { testAgent } from "../intents/test-intents.js";
import { sendLevelNotice, sendLevelNoticeKey } from "./send-level-notice.js";

const english = createFormatter({ locale: "en", timeZone: "UTC" });
const atMs = Date.UTC(2027, 0, 2, 9, 30);
const record = { agentId: testAgent, changedAtMs: 1, version: 1 };

describe("the send level notice", () => {
  it("says when a looser level takes effect", () => {
    const values = { from: "3", to: "1", pending: "yes", when: english.dateTime(atMs) };
    expect(english.message(sendLevelNoticeKey, values)).toBe(
      `Send level 3 → 1 at ${english.dateTime(atMs)}`,
    );
  });

  it("says a stricter level applies now", () => {
    const values = { from: "0", to: "2", pending: "no" };
    expect(english.message(sendLevelNoticeKey, values)).toBe("Send level 0 → 2 now");
  });

  it("is left out when no level moved", () => {
    const cancelled = sendLevelNotice(
      { level: 1, pending: { level: 0, atMs } },
      { ...record, level: 1 },
    );
    expect(cancelled).toBeUndefined();
  });
});
