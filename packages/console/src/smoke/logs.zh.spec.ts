import { expect, test } from "@playwright/test";
import { openPaired, ownerReadsChinese, shootThemes } from "./smoke-page";

ownerReadsChinese();

test("reads the engine log's newest lines in Chinese, in light and in dark", async ({
  page,
  request,
}, testInfo) => {
  const problems = await openPaired(page, request);
  await page.getByRole("link", { name: "日志" }).click();
  await expect(page.getByRole("heading", { name: "日志", level: 1 })).toBeVisible();
  const lines = page.getByRole("list", { name: "日志行" }).getByRole("listitem");
  await expect(lines).toHaveCount(3);
  await expect(page.getByText("有 1 行不是日志的 JSON 格式，因此未显示。")).toBeVisible();
  await page.getByRole("button", { name: "仅错误" }).click();
  await expect(lines).toHaveCount(1);
  await expect(lines).toContainText("rpc.failed");
  await shootThemes(page, testInfo, "logs-zh");
  expect(problems).toStrictEqual([]);
});
