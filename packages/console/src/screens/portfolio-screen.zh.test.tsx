// @vitest-environment jsdom
import { cleanup, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { fakeClient } from "../testing/fake-client";
import { portfolioAnswers } from "../testing/portfolio-fixture";
import { renderSignedIn, settle } from "../testing/render-signed-in";
import { PortfolioScreen } from "./portfolio-screen";

afterEach(cleanup);

function linesOf(list: HTMLElement): readonly string[] {
  return [...list.querySelectorAll("[data-slot=card-title], p")].map((each) => each.textContent);
}

describe("the portfolio screen in Chinese", () => {
  it("shows live and paper apart, each with its own total, the cards in the owner's language", async () => {
    const { client } = fakeClient(portfolioAnswers);
    renderSignedIn(<PortfolioScreen />, { client, locale: "zh" });
    await settle();
    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe("main · 实盘");
    const live = screen.getByRole("region", { name: "实盘资产" });
    const paper = screen.getByRole("region", { name: "模拟资产" });
    expect(within(live).getByText("实盘总计：$420.50")).toBeDefined();
    expect(within(live).getByText("暂无价格的资产不计入总计。")).toBeDefined();
    expect(within(live).getByText("暂无价格")).toBeDefined();
    expect(within(live).getByText("42000 个最小单位")).toBeDefined();
    expect(within(paper).getByText("模拟总计：$1,100.00")).toBeDefined();
    expect(linesOf(within(live).getByRole("list", { name: "持仓" }))).toStrictEqual([
      "BNB · main",
      "持有 0.5 BNB · 市值 $300.00",
      "平均成本 $550.00 · 成本 $275.00",
      "盈亏 未实现盈亏 +$25.00（+9.09%）· 已实现盈亏 $0.00",
      "费用 平台手续费 $1.50 · 网络费 $0.08",
      expect.stringMatching(/^开始于 2026/u),
    ]);
    const closed = linesOf(within(live).getByRole("list", { name: "最近 7 天已清仓" }));
    expect([closed[0], closed[2]]).toStrictEqual([
      "CAKE · main · 已清仓",
      "盈亏 已实现盈亏 -$20.00（-10.00%）",
    ]);
    expect(linesOf(within(paper).getByRole("list", { name: "持仓" }))[0]).toBe("BNB · main模拟");
    expect(within(paper).getByText("最近 7 天没有已清仓的持仓。")).toBeDefined();
  });

  it("says an agent holds nothing yet", async () => {
    const { client } = fakeClient({
      ...portfolioAnswers,
      "portfolio/get": () => ({ balances: [], positions: [], totalUsdMicros: 0n, assets: {} }),
      "portfolio/pnl": () => ({ positions: [], realizedUsdMicros: 0n, cards: [], assets: {} }),
    });
    renderSignedIn(<PortfolioScreen />, { client, locale: "zh" });
    await settle();
    expect(screen.getByText("此 Agent 还没有持有任何资产。")).toBeDefined();
  });
});
