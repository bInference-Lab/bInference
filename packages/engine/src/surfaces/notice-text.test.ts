import { assetRefSchema } from "@binference/chain";
import { createFormatter } from "@binference/i18n";
import { describe, expect, it } from "vitest";
import { testChains } from "../operations/test-engine.js";
import { lockedNotice } from "../pushes/locked-notice.js";
import { noticePush, noticeSchema } from "../pushes/notice-push.js";
import { noticeText } from "./notice-text.js";

const display = {
  formatter: createFormatter({ locale: "en", timeZone: "UTC" }),
  chains: testChains(),
};
const atMs = Date.UTC(2026, 9, 11, 9, 30, 0);
const coin = assetRefSchema.parse("fake:1/slip44:1");
const pepe = assetRefSchema.parse("fake:1/erc20:0x6982508145454Ce325dDbE47a25d4ec3d2311933");

// A notice as a surface gets it: the push's data read back through the schema.
function received(push: ReturnType<typeof noticePush>) {
  return noticeSchema.parse(JSON.parse(JSON.stringify(push.data)));
}

describe("a notice as the owner reads it", () => {
  it("writes a notice with plain values as its message says", () => {
    expect(noticeText(received(lockedNotice()), display)).toBe(
      `${String.fromCodePoint(0x1f534)} binference restarted and is locked. Run \`binference unlock\`.`,
    );
  });

  it("writes each time as the day and time in the owner's timezone", () => {
    const push = noticePush({
      key: "notice.limitChange",
      values: { surface: "telegram", limit: "perTradeUsdMicros", pending: "yes" },
      times: { when: atMs },
    });
    expect(noticeText(received(push), display)).toBe(
      "Limit changed by Telegram: the per-trade cap changes at Oct 11, 2026, 09:30:00. Not you? Cancel now.",
    );
  });

  it("writes each amount in its token's units, or in base units of a token the registry lacks", () => {
    const low = (asset: typeof coin) =>
      noticePush({
        key: "notice.lowGas",
        values: { wallet: "0x0000000c" },
        amounts: { balance: { asset, base: 15n * 10n ** 14n } },
      });
    expect([
      noticeText(received(low(coin)), display),
      noticeText(received(low(pepe)), display),
    ]).toStrictEqual([
      `${String.fromCodePoint(0x26a0, 0xfe0f)} 0x0000000c has 0.0015 FAKE left for network fees. Add BNB.`,
      `${String.fromCodePoint(0x26a0, 0xfe0f)} 0x0000000c has 1500000000000000 0x6982…1933 left for network fees. Add BNB.`,
    ]);
  });

  it("refuses notice data in another shape", () => {
    expect(noticeSchema.safeParse({ key: "notice.locked" }).success).toBe(false);
    expect(noticeSchema.safeParse({ key: "notice.locked", values: {}, extra: 1 }).success).toBe(
      false,
    );
  });
});
