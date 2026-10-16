import { type APIRequestContext, expect, type Page, test } from "@playwright/test";
import { readPairing, readProposal, readStates } from "./smoke-answers.schema";

const control = "http://127.0.0.1:7492";

// Pairs the page with the engine through a fresh link, and gathers every error or warning it logs.
async function openPaired(page: Page, request: APIRequestContext): Promise<readonly string[]> {
  const problems: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error" || message.type() === "warning") {
      problems.push(message.text());
    }
  });
  page.on("pageerror", (error) => problems.push(String(error)));
  const pairing = await request.post(`${control}/pair`);
  await page.goto(readPairing(await pairing.json()));
  return problems;
}

test("pairs this browser and confirms a paper card in it", async ({ page, request }, testInfo) => {
  const problems = await openPaired(page, request);
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

// A 1x1 PNG, the image the owner sends with the message.
const chart = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

test("chats with an image and confirms the card the agent opens inline", async ({
  page,
  request,
}, testInfo) => {
  const problems = await openPaired(page, request);
  await page.getByRole("link", { name: "Chat" }).click();
  await expect(page.getByRole("heading", { name: "Chat" })).toBeVisible();

  await page
    .locator("input[type=file]")
    .setInputFiles({ name: "chart.png", mimeType: "image/png", buffer: chart });
  await expect(page.getByRole("img", { name: "Image 1 to send" })).toBeVisible();
  await page
    .getByRole("textbox", { name: "Message to the agent" })
    .fill("Buy the token on this chart");
  await page.screenshot({ path: testInfo.outputPath("chat-compose.png"), fullPage: true });
  await page.getByRole("button", { name: "Send" }).click();

  const cards = page.getByRole("region", { name: "Waiting for your answer" });
  await expect(cards).toBeVisible({ timeout: 20_000 });
  await expect(cards).toContainText("This came after reading outside content");
  const log = page.getByRole("log", { name: "Chat with main" });
  await expect(log).toContainText("Buy the token on this chart");
  await expect(log).toContainText("1 image");
  await page.screenshot({ path: testInfo.outputPath("chat-card.png"), fullPage: true });

  await cards.getByRole("button", { name: "Confirm" }).click();
  await expect(cards).toHaveCount(0);
  // The first test's swap and this one's both filled on paper, and no card waits.
  const states = async (): Promise<readonly string[]> =>
    readStates(await (await request.get(`${control}/states`)).json());
  await expect
    .poll(async () => (await states()).filter((each) => each === "paper_filled").length)
    .toBe(2);
  expect(await states()).not.toContain("awaiting_confirmation");
  await page.screenshot({ path: testInfo.outputPath("chat-confirmed.png"), fullPage: true });
  expect(problems).toStrictEqual([]);
});
