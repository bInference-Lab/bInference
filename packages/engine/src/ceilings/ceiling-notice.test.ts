import { createFormatter } from "@binference/i18n";
import { describe, expect, it } from "vitest";
import { ceilingChangeKey } from "./ceiling-notice.js";

const english = createFormatter({ locale: "en", timeZone: "UTC" });

function say(change: string, surface = "cli"): string {
  return english.message(ceilingChangeKey, { agent: "main", surface, change });
}

describe("the ceiling change notice", () => {
  it("names the agent, the surface and what moved, and says to freeze", () => {
    expect([say("venues"), say("cap", "console"), say("both"), say("dayCaps")]).toStrictEqual([
      "⚠️ The owner key changed the ceiling of main's wallets from the CLI: the venues a contract call may use. Not you? Freeze now.",
      "⚠️ The owner key changed the ceiling of main's wallets from the console: the most one contract call may carry. Not you? Freeze now.",
      "⚠️ The owner key changed the ceiling of main's wallets from the CLI: the venues a contract call may use, and the most it may carry. Not you? Freeze now.",
      "⚠️ The owner key changed the ceiling of main's wallets from the CLI: the 24-hour caps every wallet shares. Not you? Freeze now.",
    ]);
  });
});
