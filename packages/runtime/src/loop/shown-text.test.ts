import { describe, expect, it } from "vitest";
import { withoutShownText, withShown } from "./shown-text.js";

const address = "0xb97Bd0df3824c4572179d1BB7EBc995EDAf503e0";

describe("the agent's text without what a tool showed", () => {
  it("leaves out a paragraph that repeats a shown address, in code or not", () => {
    const text = [
      "Your deposit QR code is in the message above.",
      `\`${address}\``,
      "Send only on BNB Smart Chain.",
    ].join("\n\n");
    expect(withoutShownText(text, [address])).toBe(
      "Your deposit QR code is in the message above.\n\nSend only on BNB Smart Chain.",
    );
  });

  it("leaves out a paragraph a shown text holds, whatever its case and spacing", () => {
    const shown = "Hold for hours or days? Hours / Days";
    expect(withoutShownText("hold  for HOURS or days?\n\nPick one.", [shown])).toBe("Pick one.");
  });

  it("keeps a paragraph that only mentions a shown text in passing", () => {
    const text = `Your main wallet ${address} is in paper mode, so the funds you send stay there until you switch it to live and pick what to buy.`;
    expect(withoutShownText(text, [address])).toBe(text);
  });

  it("keeps everything when nothing was shown, and never counts a text under 10 characters", () => {
    expect(withoutShownText("Done.\n\nDone.", [])).toBe("Done.\n\nDone.");
    expect(withoutShownText("Done.\n\nMore.", ["Done."])).toBe("Done.\n\nMore.");
  });

  it("can leave nothing, when the text only repeats what was shown", () => {
    expect(withoutShownText(`**${address}**`, [address])).toBe("");
  });

  it("keeps the newest 200 shown texts and skips empty ones", () => {
    const many = Array.from({ length: 205 }, (_unused, index) => `shown text ${String(index)}`);
    const kept = withShown(withShown([], ["", "  "]), many);
    expect([kept.length, kept[0], kept.at(-1)]).toStrictEqual([
      200,
      "shown text 5",
      "shown text 204",
    ]);
  });
});
