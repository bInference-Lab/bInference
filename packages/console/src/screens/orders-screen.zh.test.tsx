// @vitest-environment jsdom
import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { fakeClient } from "../testing/fake-client";
import { orderAnswers } from "../testing/orders-fixture";
import { renderSignedIn, settle } from "../testing/render-signed-in";
import { OrdersScreen } from "./orders-screen";

afterEach(cleanup);

// The list item whose text holds `words`.
function itemWith(words: string | RegExp): HTMLElement {
  const item = screen
    .getAllByRole("listitem")
    .find((each) => within(each).queryAllByText(words).length > 0);
  if (item === undefined) {
    throw new Error(`Expected an item holding ${String(words)}.`);
  }
  return item;
}

describe("the auto orders screen in Chinese", () => {
  it("names each state, mode and order in the owner's language", async () => {
    const { client } = fakeClient(orderAnswers);
    renderSignedIn(<OrdersScreen />, { client, locale: "zh" });
    await settle();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("自动订单");
    expect(screen.getByRole("region", { name: "实盘订单" })).toBeDefined();
    const paper = screen.getByRole("region", { name: "模拟订单" });
    expect(within(paper).getByText(/^止损 · 卖出 CAKE · 价格为 \$1\.80/u)).toBeDefined();
    expect(itemWith("其 Agent 已冻结，已暂停")).toBeDefined();
    expect(itemWith("正在等待卡片确认")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "已结束" }));
    await settle();
    expect(itemWith("已过期")).toBeDefined();
  });

  it("shows fills and skips and asks before a cancel in Chinese", async () => {
    const { client } = fakeClient(orderAnswers);
    renderSignedIn(<OrdersScreen />, { client, locale: "zh" });
    await settle();
    const item = itemWith("已生效");
    fireEvent.click(within(item).getByRole("button", { name: "成交与跳过" }));
    await settle();
    const table = within(item).getByRole("table", { name: "此订单的成交与跳过" });
    const outcomes = within(table)
      .getAllByRole("row")
      .slice(1)
      .map((row) => within(row).getAllByRole("cell")[1]?.textContent);
    expect(outcomes[1]).toBe("已跳过");
    expect(outcomes[3]).toBe("已模拟成交");
    expect(outcomes[0]).toMatch(/^已跳过：.*\$40\.00/u);
    fireEvent.click(within(item).getByRole("button", { name: "取消订单" }));
    expect(within(item).getByText(/它将不再在任何界面上成交/u)).toBeDefined();
    fireEvent.click(within(item).getByRole("button", { name: "立即取消" }));
    await settle();
    expect(screen.getByRole("status").textContent).toMatch(/^止损：已于 .* 取消。$/u);
  });

  it("names each alert in Chinese", async () => {
    const { client } = fakeClient(orderAnswers);
    renderSignedIn(<OrdersScreen />, { client, locale: "zh" });
    await settle();
    expect(screen.getByRole("heading", { level: 2, name: "提醒" })).toBeDefined();
    expect(screen.getByText("价格提醒：CAKE 达到或高于 $3.00")).toBeDefined();
    expect(screen.getByText("尚未触发 · 会唤醒 Agent")).toBeDefined();
    expect(screen.getByText("发射提醒：每个通过其筛选条件的新发射")).toBeDefined();
  });
});
