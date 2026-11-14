import { expect, test } from "@playwright/test";
import { openPaired, shootThemes } from "./smoke-page";

// The smoke engine's plugin lock holds fear-index, on, and whale-feed, stopped after crashing; the
// test leaves fear-index on again, as it found it.

test("shows each plugin's review, disables one and enables it again, in light and in dark", async ({
  page,
  request,
}, testInfo) => {
  const problems = await openPaired(page, request);
  await page.getByRole("link", { name: "Plugins" }).click();
  await expect(page.getByRole("heading", { name: "Plugins", level: 1 })).toBeVisible();
  const plugins = page.getByRole("list", { name: "Installed plugins" }).locator(":scope > li");
  const fear = plugins.filter({ hasText: "fear-index" });
  await expect(fear.getByText("On", { exact: true })).toBeVisible();
  await expect(fear.getByRole("list", { name: "It may reach 1 host:" })).toContainText(
    "api.alternative.me",
  );
  await expect(fear).toContainText("npm provenance: checked");
  await expect(fear).toContainText("Publisher: github.com/owner/fear-index");
  const whale = plugins.filter({ hasText: "whale-feed" });
  await expect(whale).toContainText("It crashed 5 times in 10 minutes, so binference stopped it.");
  await shootThemes(page, testInfo, "plugins");

  await fear.getByRole("button", { name: "Disable" }).click();
  await expect(fear).toContainText("fear-index is off. The agent can no longer call its tools.");
  await expect(fear).toContainText("You disabled it.");
  await fear.getByRole("button", { name: "Enable" }).click();
  await expect(fear).toContainText(
    "Enable fear-index? Its tools reach the agent from its next turn",
  );
  await shootThemes(page, testInfo, "plugins-enable-ask");
  await fear.getByRole("button", { name: "Enable it" }).click();
  await expect(fear).toContainText(
    "fear-index is on. Its tools reach the agent from its next turn.",
  );
  await expect(fear.getByRole("button", { name: "Disable" })).toBeVisible();
  expect(problems).toStrictEqual([]);
});
