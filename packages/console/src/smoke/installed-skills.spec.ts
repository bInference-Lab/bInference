import { expect, test } from "@playwright/test";
import { openPaired, shootThemes } from "./smoke-page";

// The smoke engine's state folder holds grid-trader, installed from npm, and the test agent's
// workspace skill my-notes, beside the skills binference ships.

test("lists the installed skills with where each came from, in light and in dark", async ({
  page,
  request,
}, testInfo) => {
  const problems = await openPaired(page, request);
  await page.getByRole("link", { name: "System" }).click();
  await expect(page.getByRole("heading", { name: "Skills", level: 1 })).toBeVisible();
  await expect(page.getByText("No skill proposal waits for you.")).toBeVisible();
  const installed = page.getByRole("region", { name: "Installed skills" }).getByRole("listitem");
  await expect(installed.filter({ hasText: "grid-trader" })).toContainText(
    "Installed from npm:grid-trader@1.0.0",
  );
  await expect(installed.filter({ hasText: "my-notes" })).toContainText(
    "In the workspace of main, at workspace/my-notes/SKILL.md.",
  );
  await expect(installed.filter({ hasText: "safe-swap" })).toContainText("Comes with binference.");
  await shootThemes(page, testInfo, "skills");
  expect(problems).toStrictEqual([]);
});
