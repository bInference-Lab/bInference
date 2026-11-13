import { expect, test } from "@playwright/test";
import { openPaired, shootThemes } from "./smoke-page";

// Runs after console.spec.ts and its Chinese twin: a freeze cancels the cards that wait and a
// lower limit stays, so nothing here may run before the cards and rules those tests make.

test("freezes every agent, opens the unfreeze card and confirms it, then asks for a rescue", async ({
  page,
  request,
}, testInfo) => {
  const problems = await openPaired(page, request);
  await page.getByRole("link", { name: "Safety" }).click();
  await expect(page.getByRole("heading", { name: "Safety", level: 1 })).toBeVisible();
  const freeze = page.getByRole("region", { name: "Freeze", exact: true });
  await expect(freeze).toContainText("Nothing is frozen.");
  await expect(page.getByRole("region", { name: "Rescue", exact: true })).toContainText(
    "Rescue address in effect: 0x000000a1",
  );
  await shootThemes(page, testInfo, "safety");

  await freeze.getByRole("button", { name: "Freeze every agent" }).click();
  await expect(freeze).toContainText("Freeze every agent now?");
  await shootThemes(page, testInfo, "safety-freeze-ask");
  await freeze.getByRole("button", { name: "Freeze now" }).click();
  await expect(freeze).toContainText("Every agent is frozen since");
  await expect(freeze.getByRole("list", { name: "Agents" })).toContainText("mainFrozen since");

  await freeze.getByRole("button", { name: "Unfreeze every agent" }).click();
  const card = freeze.getByRole("region", { name: "The unfreeze card", exact: true });
  await expect(card).toContainText("Unfreeze every agent: 1 is frozen now");
  await shootThemes(page, testInfo, "safety-unfreeze-card");
  await card.getByRole("button", { name: "Confirm" }).click();
  await expect(freeze).toContainText("Nothing is frozen.");
  await expect(
    freeze.getByRole("region", { name: "Closed since you opened this page", exact: true }),
  ).toBeVisible();

  const rescue = page.getByRole("region", { name: "Rescue", exact: true });
  await rescue.getByRole("button", { name: "Open the rescue card" }).click();
  await expect(rescue).toContainText("Not done: No agent wallet holds anything to rescue.");
  await shootThemes(page, testInfo, "safety-rescue-refused");
  expect(problems).toStrictEqual([]);
});

test("lowers a limit at once, raises one for after 24 hours, cancels it, and shows a refusal", async ({
  page,
  request,
}, testInfo) => {
  const problems = await openPaired(page, request);
  await page.getByRole("link", { name: "Limits" }).click();
  const form = page.getByRole("form", { name: "Change a limit of main" });
  await expect(form.getByLabel("New value")).toHaveValue("1000");

  await form.getByLabel("New value").fill("500");
  await form.getByRole("button", { name: "Change limit" }).click();
  await expect(form).toContainText("Per-trade cap is now $500.00.");

  await form.getByLabel("Limit", { exact: true }).selectOption("rollingDayUsdMicros");
  await form.getByLabel("New value").fill("6000");
  await form.getByRole("button", { name: "Change limit" }).click();
  await expect(form).toContainText("24-hour cap becomes $6,000.00 at");
  await expect(
    page.getByText(/^Looser limits that apply at .+ unless you cancel them:$/u),
  ).toBeVisible();
  await shootThemes(page, testInfo, "limits-waiting");

  await page.getByRole("button", { name: "Cancel the looser limits" }).click();
  await expect(page.getByText(/^The looser limits are cancelled/u)).toBeVisible();

  await form.getByLabel("Limit", { exact: true }).selectOption("venues");
  await form.getByLabel("New value").fill("fake-swap, nosuchvenue");
  await form.getByRole("button", { name: "Change limit" }).click();
  await expect(form).toContainText("Not changed: ");
  await shootThemes(page, testInfo, "limits-refused");
  expect(problems).toStrictEqual([]);
});
