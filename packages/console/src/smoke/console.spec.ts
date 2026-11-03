import { expect, test } from "@playwright/test";
import { showHeldElsewhere } from "./held-elsewhere";
import { readProposal, readStates } from "./smoke-answers.schema";
import { alertTo, control, openPaired, shootThemes } from "./smoke-page";

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

test("answers the agent's question with a button in the chat", async ({
  page,
  request,
}, testInfo) => {
  const problems = await openPaired(page, request);
  await page.getByRole("link", { name: "Chat" }).click();
  await page.getByRole("textbox", { name: "Message to the agent" }).fill("Ask me first");
  await page.getByRole("button", { name: "Send" }).click();

  const asked = page.getByRole("region", { name: "main asks" });
  await expect(asked).toContainText("How long do you like to hold a token?", { timeout: 20_000 });
  await expect(asked).toContainText("Or write your own answer.");
  await page.screenshot({ path: testInfo.outputPath("question.png"), fullPage: true });

  await asked.getByRole("button", { name: "Hours" }).click();
  await expect(asked).toContainText("Answered: Hours");
  await expect(asked.getByRole("button")).toHaveCount(0);
  const log = page.getByRole("log", { name: "Chat with main" });
  await expect(log).toContainText("Hours it is.", { timeout: 20_000 });
  await page.screenshot({ path: testInfo.outputPath("question-answered.png"), fullPage: true });
  expect(problems).toStrictEqual([]);
});

test("shows the paper portfolio apart from any live one, in light and in dark", async ({
  page,
  request,
}, testInfo) => {
  const problems = await openPaired(page, request);
  await page.getByRole("link", { name: "Portfolio" }).click();
  await expect(page.getByRole("heading", { name: "Portfolio", level: 1 })).toBeVisible();
  const paper = page.getByRole("region", { name: "Paper holdings" });
  await expect(paper).toContainText("Paper total: $");
  await expect(page.getByRole("region", { name: "Live holdings" })).toHaveCount(0);
  // The earlier tests' swaps filled on paper, so the paper section holds their positions.
  await expect(paper.getByRole("list", { name: "Positions" }).getByText("Paper")).not.toHaveCount(
    0,
  );
  const background = async (): Promise<string> =>
    page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  await page.emulateMedia({ colorScheme: "light" });
  expect(await background()).toBe("rgb(255, 255, 255)");
  await page.screenshot({
    path: testInfo.outputPath("portfolio-light.png"),
    fullPage: true,
    animations: "disabled",
  });
  await page.emulateMedia({ colorScheme: "dark" });
  expect(await background()).toBe("rgb(11, 14, 17)");
  await page.screenshot({
    path: testInfo.outputPath("portfolio-dark.png"),
    fullPage: true,
    animations: "disabled",
  });
  expect(problems).toStrictEqual([]);
});

test("shows stakes and a bridge in transit in the portfolio, in light and in dark", async ({
  page,
  request,
}, testInfo) => {
  await showHeldElsewhere(page);
  const problems = await openPaired(page, request);
  await page.getByRole("link", { name: "Portfolio" }).click();
  const live = page.getByRole("region", { name: "Live holdings" });
  const staked = live.getByRole("list", { name: "Staking" }).getByRole("listitem");
  await expect(staked).toHaveText(
    [
      "1.05 FAKE staked with 0x2222…0001 · worth $630.00" +
        "0.5 FAKE unbonding, claimable from Oct 17, 2026, 09:30:00" +
        "0.1 FAKE ready to claim",
    ],
    { timeout: 20_000 },
  );
  await expect(live.getByRole("list", { name: "In transit" })).toHaveText(
    /^50 TKN to 0x4444…0001 on Base · since Oct 10, 2026, 09:30:00 · late$/u,
  );
  const paper = page.getByRole("region", { name: "Paper holdings" });
  await expect(paper.getByRole("list", { name: "Staking" })).toHaveText(
    "0.4725 FAKE staked with 0x2222…0001 · worth $283.50",
  );
  await expect(paper.getByRole("list", { name: "In transit" })).toHaveCount(0);
  await shootThemes(page, testInfo, "portfolio-staking");
  expect(problems).toStrictEqual([]);
});

// Runs last: the rule's card and its fill are intents of the agent the tests before it count.
test("makes an alert rule, fills an alert on paper, and refuses its old URL once rotated", async ({
  page,
  request,
}, testInfo) => {
  const problems = await openPaired(page, request);
  await page.getByRole("link", { name: "Alert rules" }).click();
  await expect(page.getByRole("heading", { name: "Alert rules", level: 1 })).toBeVisible();
  const form = page.getByRole("form", { name: "New alert rule" });
  await form.getByLabel("Name", { exact: true }).fill("TKN breakout");
  await form.getByLabel("Token", { exact: true }).fill("TKN");
  await form.getByLabel("A buy spends", { exact: true }).fill("FAKE");
  await form.getByLabel("Each fill is sized in").selectOption("amount");
  await form.getByLabel("Each fill", { exact: true }).fill("0.001");
  await form.getByLabel("Alerts a minute, 1 to 60").fill("5");
  await form.getByRole("button", { name: "Create rule" }).click();

  const shown = form.getByLabel("Alert rule URL");
  await expect(shown).toBeVisible();
  const url = await shown.inputValue();
  expect(url).toMatch(/\/hook\/whr_[^/]+\/[\w-]{43}$/u);
  const rule = page.getByRole("listitem").filter({ hasText: "TKN breakout" });
  await expect(rule).toContainText("Waits for its card");
  await shootThemes(page, testInfo, "rules-created");
  await form.getByRole("button", { name: "I copied it" }).click();
  await expect(shown).toHaveCount(0);

  await rule.getByRole("button", { name: "Confirm" }).click();
  await expect(rule).toContainText("Active");
  const tradingView = '{"id":"tv-1","ticker":"TKNUSDT","action":"buy"}';
  expect(await alertTo(request, url, tradingView)).toStrictEqual({ status: 202, fills: 1 });
  await page.reload();
  await rule.getByRole("button", { name: "Alerts" }).click();
  const events = rule.getByRole("table", { name: "Alerts to TKN breakout" });
  await expect(events).toContainText("Filled on paper");

  await rule.getByRole("button", { name: "Rotate URL" }).click();
  await rule.getByRole("button", { name: "Rotate now" }).click();
  const rotated = rule.getByLabel("Alert rule URL");
  await expect(rotated).toBeVisible();
  const newUrl = await rotated.inputValue();
  expect(newUrl).not.toBe(url);
  expect(await alertTo(request, url, "TKN up again")).toStrictEqual({ status: 404, fills: 1 });
  expect((await alertTo(request, newUrl, "TKN up once more")).status).toBe(202);
  await shootThemes(page, testInfo, "rules-rotated");
  expect(problems).toStrictEqual([]);
});
