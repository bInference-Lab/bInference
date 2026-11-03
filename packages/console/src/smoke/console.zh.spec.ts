import { expect, test } from "@playwright/test";
import { showHeldElsewhere } from "./held-elsewhere";
import { control, openPaired, shootThemes } from "./smoke-page";

// Runs after console.spec.ts, whose last test made and confirmed the rule this one shows. The
// console speaks the owner's language once signed in, so the owner reads Chinese for this test.
test.beforeEach(async ({ request }) => {
  await request.post(`${control}/locale?locale=zh`);
});

test.afterEach(async ({ request }) => {
  await request.post(`${control}/locale?locale=en`);
});

test("shows stakes and a bridge in transit in Chinese, in light and in dark", async ({
  page,
  request,
}, testInfo) => {
  await showHeldElsewhere(page);
  const problems = await openPaired(page, request);
  await page.getByRole("link", { name: "投资组合" }).click();
  const live = page.getByRole("region", { name: "实盘资产" });
  await expect(live.getByRole("list", { name: "质押" })).toContainText(
    "在 0x2222…0001 质押 1.05 FAKE · 市值 $630.00",
    { timeout: 20_000 },
  );
  await expect(live.getByRole("list", { name: "质押" })).toContainText("0.5 FAKE 解绑中");
  await expect(live.getByRole("list", { name: "在途" })).toContainText(
    "50 TKN 跨链到 Base 的 0x4444…0001",
  );
  const paper = page.getByRole("region", { name: "模拟资产" });
  await expect(paper.getByRole("list", { name: "质押" })).toHaveText(
    "在 0x2222…0001 质押 0.4725 FAKE · 市值 $283.50",
  );
  await shootThemes(page, testInfo, "portfolio-staking-zh");
  expect(problems).toStrictEqual([]);
});

test("shows the alert rules screen in Chinese, in light and in dark", async ({
  page,
  request,
}, testInfo) => {
  const problems = await openPaired(page, request);
  await page.getByRole("link", { name: "提醒规则" }).click();
  await expect(page.getByRole("heading", { name: "提醒规则", level: 1 })).toBeVisible();
  const rule = page.getByRole("listitem").filter({ hasText: "TKN breakout" });
  await expect(rule).toContainText("已生效");
  await rule.getByRole("button", { name: "提醒记录" }).click();
  await expect(rule.getByRole("table")).toContainText("已模拟成交");
  await shootThemes(page, testInfo, "rules-zh");
  expect(problems).toStrictEqual([]);
});
