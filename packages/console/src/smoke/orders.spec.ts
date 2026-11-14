import { expect, test } from "@playwright/test";
import { readOrder, readState } from "./smoke-answers.schema";
import { control, openPaired, shootThemes } from "./smoke-page";

// Runs before safety.spec.ts, whose freeze would cancel the card the order waits on.

test("confirms a paper order's card, cancels the order, and reads it cancelled in the engine", async ({
  page,
  request,
}, testInfo) => {
  const order = readOrder(await (await request.post(`${control}/order`)).json());
  const problems = await openPaired(page, request);
  await page.getByRole("link", { name: "Auto orders" }).click();
  await expect(page.getByRole("heading", { name: "Auto orders", level: 1 })).toBeVisible();
  const paper = page.getByRole("region", { name: "Paper orders" });
  const item = paper.getByRole("listitem").filter({ hasText: /^Stop-loss · sell / });
  await expect(item).toContainText("Waits for its card");
  await item.getByRole("button", { name: "Confirm" }).click();
  await expect(item).toContainText("Active");
  await expect(page.getByText("No alert is active.")).toBeVisible();
  await item.getByRole("button", { name: "Fills and skips" }).click();
  await expect(item).toContainText("No fill or skip yet.");
  await shootThemes(page, testInfo, "orders");

  await item.getByRole("button", { name: "Cancel order" }).click();
  await expect(item).toContainText("Cancel this order now?");
  await shootThemes(page, testInfo, "orders-cancel-ask");
  await item.getByRole("button", { name: "Cancel now" }).click();
  await expect(page.getByText(/^Stop-loss: cancelled at .+\.$/u)).toBeVisible();
  const held = await request.get(`${control}/order?order=${order}`);
  expect(readState(await held.json())).toBe("cancelled");

  await page.getByRole("button", { name: "Ended" }).click();
  const ended = page
    .getByRole("region", { name: "Paper orders" })
    .getByRole("listitem")
    .filter({ hasText: "Cancelled" });
  await expect(ended).toHaveCount(1);
  await shootThemes(page, testInfo, "orders-ended");
  expect(problems).toStrictEqual([]);
});
