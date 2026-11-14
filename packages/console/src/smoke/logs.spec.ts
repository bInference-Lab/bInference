import { expect, test } from "@playwright/test";
import { openPaired, shootThemes } from "./smoke-page";

// The smoke engine's log holds an info line, a warning that names a host, an error and a line of
// free text.

test("reads the engine log's newest lines by the bundle's rules, in light and in dark", async ({
  page,
  request,
}, testInfo) => {
  const problems = await openPaired(page, request);
  await page.getByRole("link", { name: "Logs" }).click();
  await expect(page.getByRole("heading", { name: "Logs", level: 1 })).toBeVisible();
  const lines = page.getByRole("list", { name: "Log lines" }).getByRole("listitem");
  await expect(lines).toHaveCount(3);
  await expect(lines.filter({ hasText: "order.skipped" })).toContainText("host=[omitted]");
  await expect(page.getByRole("list", { name: "Log lines" })).not.toContainText("rpc.example.com");
  await expect(
    page.getByText("1 line was left out, since it is not in the log's JSON shape."),
  ).toBeVisible();
  await shootThemes(page, testInfo, "logs");

  await page.getByRole("button", { name: "Warnings and errors" }).click();
  await expect(lines).toHaveCount(2);
  await expect(lines.filter({ hasText: "server.listening" })).toHaveCount(0);
  await page.getByRole("button", { name: "Reload" }).click();
  await expect(lines).toHaveCount(2);
  await shootThemes(page, testInfo, "logs-warnings");
  expect(problems).toStrictEqual([]);
});
