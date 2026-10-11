import { expect, test } from "@playwright/test";
import { readPairing, readProposal } from "./smoke-answers.schema";

const control = "http://127.0.0.1:7492";

test("pairs this browser and confirms a paper card in it", async ({ page, request }, testInfo) => {
  const problems: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error" || message.type() === "warning") {
      problems.push(message.text());
    }
  });
  page.on("pageerror", (error) => problems.push(String(error)));

  const pairing = await request.post(`${control}/pair`);
  await page.goto(readPairing(await pairing.json()));
  await expect(page.getByRole("heading", { name: "Confirmations" })).toBeVisible();
  await expect(page.getByText("Nothing waits for your confirmation.")).toBeVisible();
  expect(new URL(page.url()).hash).toBe("");

  const proposal = await request.post(`${control}/propose`);
  const intent = readProposal(await proposal.json());
  const confirm = page.getByRole("button", { name: "Confirm" });
  await expect(confirm).toBeVisible();
  await expect(page.getByText("Confirm swap", { exact: false })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("card.png"), fullPage: true });

  await confirm.click();
  await expect(page.getByText("Nothing waits for your confirmation.")).toBeVisible();
  const settled = await request.get(`${control}/intent?intent=${intent}`);
  expect(await settled.json()).toStrictEqual({ state: "paper_filled" });
  await page.screenshot({ path: testInfo.outputPath("confirmed.png"), fullPage: true });

  await page.goto("/ledger");
  await expect(page.getByRole("heading", { name: "Ledger" })).toBeVisible();
  expect(problems).toStrictEqual([]);
});
