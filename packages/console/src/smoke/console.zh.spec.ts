import { expect, test } from "@playwright/test";
import { heldElsewhere } from "./held-elsewhere";
import { rewriteReplies } from "./rewrite-replies";
import { openDraft } from "./smoke-draft";
import { control, openPaired, ownerReadsChinese, shootThemes } from "./smoke-page";

// Runs after console.spec.ts, whose last test made and confirmed the rule this one shows.
ownerReadsChinese();

test("shows stakes and a bridge in transit in Chinese, in light and in dark", async ({
  page,
  request,
}, testInfo) => {
  await rewriteReplies(page, heldElsewhere);
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

test("shows the agent's launch draft in Chinese, read-only, in light and in dark", async ({
  page,
  request,
}, testInfo) => {
  await rewriteReplies(page, openDraft);
  const problems = await openPaired(page, request);
  await page.getByRole("link", { name: "对话" }).click();
  const drafted = page.getByRole("region", { name: /^main 起草了这次代币发射。/u });
  await expect(drafted).toContainText("请在与机器人的 Telegram 对话中从此草稿开始发射", {
    timeout: 20_000,
  });
  await expect(drafted.getByRole("img", { name: "发射草稿的图片" })).toBeVisible();
  await expect(drafted.getByRole("button")).toHaveCount(0);
  await shootThemes(page, testInfo, "draft-zh");
  expect(problems).toStrictEqual([]);
});

test("confirms a paper card in Chinese and keeps it with its receipt", async ({
  page,
  request,
}, testInfo) => {
  const problems = await openPaired(page, request);
  await expect(page.getByRole("heading", { name: "待确认" })).toBeVisible();
  await request.post(`${control}/propose`);
  await page.getByRole("button", { name: "确认" }).click();
  const closed = page.getByRole("region", { name: "打开本页后已关闭的卡片" });
  await expect(closed).toContainText("模拟成交：", { timeout: 20_000 });
  await expect(closed.getByRole("button")).toHaveCount(0);
  await shootThemes(page, testInfo, "receipt-zh");
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
