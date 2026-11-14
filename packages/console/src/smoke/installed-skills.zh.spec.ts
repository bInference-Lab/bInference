import { expect, test } from "@playwright/test";
import { openPaired, ownerReadsChinese, shootThemes } from "./smoke-page";

ownerReadsChinese();

test("lists the installed skills in Chinese, in light and in dark", async ({
  page,
  request,
}, testInfo) => {
  const problems = await openPaired(page, request);
  await page.getByRole("link", { name: "系统" }).click();
  await expect(page.getByRole("heading", { name: "技能", level: 1 })).toBeVisible();
  const installed = page.getByRole("region", { name: "已安装的技能" }).getByRole("listitem");
  await expect(installed.filter({ hasText: "grid-trader" })).toContainText(
    "从 npm:grid-trader@1.0.0 安装",
  );
  await expect(installed.filter({ hasText: "my-notes" })).toContainText(
    "位于 main 的工作区：workspace/my-notes/SKILL.md。",
  );
  await expect(installed.filter({ hasText: "safe-swap" })).toContainText("随 binference 提供。");
  await shootThemes(page, testInfo, "skills-zh");
  expect(problems).toStrictEqual([]);
});
