import { expect, test } from "@playwright/test";
import { openPaired, ownerReadsChinese, shootThemes } from "./smoke-page";

// Runs after safety.spec.ts, which left nothing frozen.
ownerReadsChinese();

test("freezes one agent and opens its unfreeze card in Chinese, in light and in dark", async ({
  page,
  request,
}, testInfo) => {
  const problems = await openPaired(page, request);
  await page.getByRole("link", { name: "安全" }).click();
  await expect(page.getByRole("heading", { name: "安全", level: 1 })).toBeVisible();
  const freeze = page.getByRole("region", { name: "冻结", exact: true });
  await freeze.getByRole("button", { name: "冻结 main" }).click();
  await expect(freeze).toContainText("立即冻结 main？");
  await freeze.getByRole("button", { name: "立即冻结" }).click();
  await expect(freeze.getByRole("list", { name: "Agent" })).toContainText("起冻结");

  await freeze.getByRole("button", { name: "解除冻结 main" }).click();
  const card = freeze.getByRole("region", { name: "解除冻结卡片", exact: true });
  await expect(card).toContainText("对 main 解除冻结：它可以在交易限额内再次交易");
  await expect(page.getByRole("region", { name: "紧急转出", exact: true })).toContainText(
    "当前生效的紧急转出地址：0x000000a1",
  );
  await shootThemes(page, testInfo, "safety-zh");
  await card.getByRole("button", { name: "确认" }).click();
  await expect(freeze).toContainText("没有任何冻结。");
  expect(problems).toStrictEqual([]);
});

test("changes a limit in Chinese, in light and in dark", async ({ page, request }, testInfo) => {
  const problems = await openPaired(page, request);
  await page.getByRole("link", { name: "交易限额" }).click();
  const form = page.getByRole("form", { name: "修改 main 的限额" });
  await form.getByLabel("限额", { exact: true }).selectOption("slippageRegistryBps");
  await expect(form.getByLabel("新值")).toHaveValue("0.5");
  await form.getByLabel("新值").fill("0.25");
  await form.getByRole("button", { name: "修改限额" }).click();
  await expect(form).toContainText("现为 0.25%。");
  await shootThemes(page, testInfo, "limits-zh");
  expect(problems).toStrictEqual([]);
});
