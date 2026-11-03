import { expect, test } from "@playwright/test";
import { control, openPaired, shootThemes } from "./smoke-page";

// Runs after console.spec.ts, whose last test made and confirmed the rule this one shows. The
// console speaks the owner's language once signed in, so the owner reads Chinese for this test.
test.beforeEach(async ({ request }) => {
  await request.post(`${control}/locale?locale=zh`);
});

test.afterEach(async ({ request }) => {
  await request.post(`${control}/locale?locale=en`);
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
