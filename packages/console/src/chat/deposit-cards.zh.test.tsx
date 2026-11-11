// @vitest-environment jsdom
import { act, cleanup, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ChatScreen } from "../screens/chat-screen";
import { fakeClient } from "../testing/fake-client";
import { renderSignedIn, settle } from "../testing/render-signed-in";

afterEach(cleanup);

const agent = "agt_0190f1c2-3a4b-7c5d-8e6f-000000000001";
const turn = "trn_0190f1c2-3a4b-7c5d-8e6f-000000000001";
const address = "0x52908400098527886E0F7030069857D2E4169EE7";
const main = {
  wallet: "wal_0190f1c2-3a4b-7c5d-8e6f-000000000010",
  agent,
  address: `eip155:56:${address}`,
  chainName: "BNB Smart Chain",
  explorerLink: `https://bscscan.com/address/${address}`,
  label: "主钱包",
  createdAt: 1,
};

describe("the wallets the agent showed to fund, in Chinese", () => {
  it("speaks the owner's language on every line, as Telegram's caption does", async () => {
    const engine = fakeClient({
      "agent/list": () => ({
        items: [{ agent, name: "main", mode: "paper", locale: "zh", createdAt: 1, changedAt: 1 }],
      }),
      "chat/messages": () => ({ items: [] }),
      "intent/list": () => ({ items: [] }),
      "chat/openQuestion": () => ({}),
    });
    renderSignedIn(<ChatScreen />, { client: engine.client, locale: "zh" });
    await settle();
    act(() =>
      engine.push(`chat:${agent}`, "chat/deposit", {
        agent,
        turn,
        mode: "paper",
        frozen: true,
        wallets: [main],
      }),
    );
    const list = screen.getByRole("list", { name: "为 main 充值的地址" });
    const card = within(list).getByRole("region", { name: "主钱包 · Agent 钱包" });
    expect(within(card).getByRole("figure", { name: `${address} 的二维码` })).toBeDefined();
    expect(within(card).getByRole("button", { name: "复制地址" })).toBeDefined();
    expect(within(card).getByRole("link", { name: "在 bscscan.com 查看" })).toBeDefined();
    expect(
      [...card.querySelectorAll("blockquote p")].map((line) => line.textContent),
    ).toStrictEqual([
      "只向此地址发送 BNB Smart Chain 上的资产。通过其他任何网络发送的资产都可能丢失。",
      "模拟 模拟模式，只做模拟交易：转账到这里的是真钱，会留在这个钱包里，直到你把 Agent 切换为实盘。",
      "已冻结：转账的资金会到账，但在你解除冻结之前 Agent 不会交易。",
    ]);
  });
});
