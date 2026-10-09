import { createFormatter } from "@binference/i18n";
import { describe, expect, it } from "vitest";
import { unfrozenNoticeKey } from "./write-unfreeze.js";

const green = String.fromCodePoint(0x1f7e2);
const english = createFormatter({ locale: "en", timeZone: "UTC" });

describe("the unfrozen notice", () => {
  it("names the agent, or every agent, and the surface that tapped Confirm", () => {
    expect(
      english.message(unfrozenNoticeKey, { scope: "agent", agent: "main", surface: "telegram" }),
    ).toBe(`${green} main is unfrozen from Telegram.`);
    expect(english.message(unfrozenNoticeKey, { scope: "install", surface: "cli" })).toBe(
      `${green} Every agent is unfrozen from the CLI.`,
    );
  });
});
