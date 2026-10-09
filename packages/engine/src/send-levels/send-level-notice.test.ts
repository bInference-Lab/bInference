import { createFormatter } from "@binference/i18n";
import { describe, expect, it } from "vitest";
import { testAgent } from "../intents/test-intents.js";
import {
  sendLevelCancelledKey,
  sendLevelNoticeKey,
  sendLevelNotices,
} from "./send-level-notice.js";

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

  it("says a looser level was cancelled and which level stays", () => {
    const values = { to: "0", level: "1" };
    expect(english.message(sendLevelCancelledKey, values)).toBe(
      "Send level change to 0 cancelled; it stays 1",
    );
  });

  it("announces nothing for a move that changed nothing", () => {
    expect(sendLevelNotices({ level: 1 }, { ...record, level: 1 })).toStrictEqual([]);
  });
});
