import { expect, test } from "@playwright/test";
import { readOrder, readState } from "./smoke-answers.schema";
import { control, openPaired, ownerReadsChinese, shootThemes } from "./smoke-page";

// Runs after orders.spec.ts, whose cancelled order shows among those that ended, and before
// safety.spec.ts, whose freeze would cancel the card the order waits on.
ownerReadsChinese();

test("cancels a paper order in Chinese and reads it cancelled in the engine, in light and in dark", async ({
  page,
  request,
}, testInfo) => {
  const order = readOrder(await (await request.post(`${control}/order`)).json());
  const problems = await openPaired(page, request);
  await page.getByRole("link", { name: "自动订单" }).click();
  await expect(page.getByRole("heading", { name: "自动订单", level: 1 })).toBeVisible();
  const paper = page.getByRole("region", { name: "模拟订单" });
  const item = paper.getByRole("listitem").filter({ hasText: /^止损 · 卖出 / });
  await expect(item).toContainText("正在等待卡片确认");
  await item.getByRole("button", { name: "确认" }).click();
  await expect(item).toContainText("已生效");
  await expect(page.getByText("没有生效中的提醒。")).toBeVisible();
  await shootThemes(page, testInfo, "orders-zh");

  await item.getByRole("button", { name: "取消订单" }).click();
  await expect(item).toContainText("现在取消此订单吗？");
  await item.getByRole("button", { name: "立即取消" }).click();
  await expect(page.getByText(/^止损：已于 .+ 取消。$/u)).toBeVisible();
  const held = await request.get(`${control}/order?order=${order}`);
  expect(readState(await held.json())).toBe("cancelled");

  await page.getByRole("button", { name: "已结束" }).click();
  const ended = page
    .getByRole("region", { name: "模拟订单" })
    .getByRole("listitem")
    .filter({ hasText: "已取消" });
  await expect(ended).toHaveCount(2);
  await shootThemes(page, testInfo, "orders-ended-zh");
  expect(problems).toStrictEqual([]);
});
