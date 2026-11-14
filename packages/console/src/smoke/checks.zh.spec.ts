import { expect, test } from "@playwright/test";
import { chineseNav } from "./chinese-nav.zh";
import { openSystemPage } from "./smoke-nav";
import { openPaired, ownerReadsChinese, shootThemes } from "./smoke-page";

ownerReadsChinese();

test("runs the checks in Chinese, in light and in dark", async ({ page, request }, testInfo) => {
  const problems = await openPaired(page, request);
  await openSystemPage(page, chineseNav, "检查");
  await page.getByRole("button", { name: "运行检查" }).click();
  await expect(page.getByText("已运行 6 项检查：1 个问题，1 个警告。")).toBeVisible();
  await expect(page.getByRole("region", { name: "问题" })).toContainText(
    "本机的其他账户可以打开 state/keys。",
  );
  await shootThemes(page, testInfo, "checks-zh");
  expect(problems).toStrictEqual([]);
});
