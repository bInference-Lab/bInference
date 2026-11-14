import { expect, test } from "@playwright/test";
import { openPaired, ownerReadsChinese, shootThemes } from "./smoke-page";

// Runs after plugins.spec.ts, which leaves fear-index on as it found it; this test does too.
ownerReadsChinese();

test("disables and enables a plugin in Chinese, in light and in dark", async ({
  page,
  request,
}, testInfo) => {
  const problems = await openPaired(page, request);
  await page.getByRole("link", { name: "插件" }).click();
  await expect(page.getByRole("heading", { name: "插件", level: 1 })).toBeVisible();
  const plugins = page.getByRole("list", { name: "已安装的插件" }).locator(":scope > li");
  const fear = plugins.filter({ hasText: "fear-index" });
  await expect(fear.getByText("已启用", { exact: true })).toBeVisible();
  await expect(fear).toContainText("npm 来源证明：已核验");
  const whale = plugins.filter({ hasText: "whale-feed" });
  await expect(whale).toContainText("它在 10 分钟内崩溃了 5 次，因此 binference 已将其停止。");
  await shootThemes(page, testInfo, "plugins-zh");

  await fear.getByRole("button", { name: "停用" }).click();
  await expect(fear).toContainText("fear-index 已停用。Agent 不能再使用它的工具。");
  await expect(fear).toContainText("由你停用。");
  await fear.getByRole("button", { name: "启用" }).click();
  await expect(fear).toContainText("启用 fear-index？");
  await shootThemes(page, testInfo, "plugins-enable-ask-zh");
  await fear.getByRole("button", { name: "确认启用" }).click();
  await expect(fear).toContainText("fear-index 已启用。从下一轮起，Agent 可以使用它的工具。");
  expect(problems).toStrictEqual([]);
});
