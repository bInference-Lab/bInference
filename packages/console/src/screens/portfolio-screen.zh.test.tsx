// @vitest-environment jsdom
import { cleanup, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { fakeClient } from "../testing/fake-client";
import { portfolioAnswers } from "../testing/portfolio-fixture";
import { renderSignedIn, settle } from "../testing/render-signed-in";
import { PortfolioScreen } from "./portfolio-screen";

afterEach(cleanup);

describe("the portfolio screen in Chinese", () => {
  it("shows live and paper apart, each with its own total, in the owner's language", async () => {
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
  });

  it("says an agent holds nothing yet", async () => {
    const { client } = fakeClient({
      ...portfolioAnswers,
      "portfolio/get": () => ({ balances: [], positions: [], totalUsdMicros: 0n, assets: {} }),
    });
    renderSignedIn(<PortfolioScreen />, { client, locale: "zh" });
    await settle();
    expect(screen.getByText("此 Agent 还没有持有任何资产。")).toBeDefined();
  });
});
