// @vitest-environment jsdom
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { fakeClient } from "../testing/fake-client";
import { closingAnswers, receiptLines } from "../testing/receipt-fixture";
import { renderSignedIn, settle } from "../testing/render-signed-in";
import { ConfirmationsScreen } from "./confirmations-screen";

afterEach(cleanup);

describe("a closed card in Chinese", () => {
  it.each([
    ["paper", "模拟 模拟成交：0.5 BNB → 312.5 USDT"],
    ["filled", "已通过 已完成：0.5 BNB → 312.5 USDT · https://bscscan.com/tx/0xabab"],
    [
      "bridgeDelivered",
      "已通过 已在 Base 到账：0x4444…0001 收到 50 USDT · https://bscscan.com/tx/0xabab",
    ],
    [
      "identity",
      "已通过 已在 ERC-8004 身份注册表中登记为 Agent 42 · https://bscscan.com/tx/0xabab",
    ],
  ] as const)("shows a %s receipt in place of its buttons", async (kind, line) => {
    const engine = fakeClient(closingAnswers(receiptLines[kind]));
    renderSignedIn(<ConfirmationsScreen />, { client: engine.client, locale: "zh" });
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "确认" }));
    await settle();
    const closed = screen.getByRole("region", { name: "打开本页后已关闭的卡片" });
    expect(closed.querySelector("[data-slot=card-footer]")?.textContent).toBe(line);
  });
});
