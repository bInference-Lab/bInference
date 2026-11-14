import { expect, test } from "@playwright/test";
import { englishNav, openSystemPage } from "./smoke-nav";
import { openPaired, shootThemes } from "./smoke-page";

// The smoke engine's check/run answers findings of every level: a problem, a warning, a note, two
// checks that passed and one this system gives nothing to read.

test("runs the checks in the engine and shows their report, in light and in dark", async ({
  page,
  request,
}, testInfo) => {
  const problems = await openPaired(page, request);
  await openSystemPage(page, englishNav, "Checks");
  await page.getByRole("button", { name: "Run the checks" }).click();
  await expect(page.getByText("6 checks ran: 1 problem and 1 warning.")).toBeVisible();
  await expect(page.getByRole("region", { name: "Problems" })).toContainText(
    "Other accounts on this machine can open state/keys.",
  );
  await expect(page.getByRole("region", { name: "Good to know" })).toContainText(
    "Community plugins can run here",
  );
  await expect(page.getByRole("button", { name: "Run the checks again" })).toBeVisible();
  await shootThemes(page, testInfo, "checks");
  expect(problems).toStrictEqual([]);
});
