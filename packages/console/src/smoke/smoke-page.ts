import type { APIRequestContext, Page, TestInfo } from "@playwright/test";
import { readAlert, readPairing } from "./smoke-answers.schema";

/** The smoke engine's control listener, which the browser tests drive it through. */
export const control = "http://127.0.0.1:7492";

/** Pairs the page with the engine through a fresh link, and gathers every error or warning it logs. */
export async function openPaired(
  page: Page,
  request: APIRequestContext,
): Promise<readonly string[]> {
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

/** Shoots the page in light, then in dark, each named for what it shows and its theme. */
export async function shootThemes(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  for (const colorScheme of ["light", "dark"] as const) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- each theme is drawn, then shot, in turn
    await page.emulateMedia({ colorScheme });
    // oxlint-disable-next-line eslint/no-await-in-loop -- each theme is drawn, then shot, in turn
    await page.screenshot({
      path: testInfo.outputPath(`${name}-${colorScheme}.png`),
      fullPage: true,
      animations: "disabled",
    });
  }
  await page.emulateMedia({ colorScheme: "light" });
}

/** Sends an alert with this body to a rule's URL through the smoke engine's webhook listener. */
export async function alertTo(
  request: APIRequestContext,
  url: string,
  body: string,
): Promise<{ readonly status: number; readonly fills: number }> {
  const sent = await request.post(`${control}/alert`, { data: { url, body } });
  return readAlert(await sent.json());
}
