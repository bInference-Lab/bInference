import { bpsSchema, type Id, idSchema } from "@binference/core";
import { cardLineText, createFormatter } from "@binference/i18n";
import type { WebhookRuleRequest } from "@binference/protocol";
import { receiptAfterLine } from "../confirmations/card-closing.js";
import { expectOk, testAgent, testToken } from "../intents/test-intents.js";
import type { EngineCaller } from "../operations/engine-call.js";
import { testCall, testCallers, testChains, type TestEngine } from "../operations/test-engine.js";
import { startOrderEngine, tapCard } from "../orders/test-orders.js";
import { writtenReceiptOf } from "../surfaces/written-receipt.js";
import { createWebhookIntake, type WebhookAnswer } from "./webhook-intake.js";

/** A webhook rule of the test agent: sell half its test token on each alert, five a minute. */
export function testRuleRequest(changes: Partial<WebhookRuleRequest> = {}): WebhookRuleRequest {
  return {
    agent: testAgent,
    name: "BNB breakout",
    token: testToken,
    side: "sell",
    size: { percentBps: bpsSchema.parse(5_000) },
    ratePerMinute: 5,
    ...changes,
  };
}

/** A rule `webhookRule/create` made, with its URL's rule id and secret and its card's intent. */
export interface CreatedRule {
  readonly rule: Id<"whr">;
  readonly url: string;
  readonly secret: string;
  readonly intent: Id<"int">;
}

const urlPattern = /\/hook\/(whr_[^/]+)\/([\w-]{43})$/;

/** The rule id and secret a rule's URL ends with. */
export function routeOf(url: string): { readonly ruleId: string; readonly secret: string } {
  const [, ruleId, secret] = urlPattern.exec(url) ?? [];
  if (ruleId === undefined || secret === undefined) {
    throw new Error(`Expected a rule URL, got ${url}.`);
  }
  return { ruleId, secret };
}

/** Creates a rule from a caller, which must answer its URL and store its card's intent. */
export async function createdRule(
  test: TestEngine,
  request: WebhookRuleRequest = testRuleRequest(),
  caller: EngineCaller = testCallers.cli,
): Promise<CreatedRule> {
  const handler = test.engine.handlers["webhookRule/create"];
  const { rule, url } = expectOk(await handler(testCall(request, caller)));
  const stored = await test.stores.webhookRules.get(rule, { signal: new AbortController().signal });
  if (stored === undefined) {
    throw new Error(`Expected rule ${rule} to be stored.`);
  }
  return { rule, url, secret: routeOf(url).secret, intent: idSchema("int").parse(stored.intentId) };
}

/** What the webhook listener answers an alert to `url` with this body, on the test's stores. */
export async function alertTo(
  test: TestEngine,
  url: string,
  body = "BNBUSDT crossed 600",
): Promise<WebhookAnswer> {
  const { webhookAlerts: store } = test.stores;
  const intake = createWebhookIntake({
    store,
    clock: test.clock,
    isLocked: test.engineOptions.isLocked,
  });
  const bytes = new TextEncoder().encode(body);
  return intake.take({ ...routeOf(url), body: bytes }, { signal: new AbortController().signal });
}

/** A rule's card and, once confirmed, its receipt, line by line in a language without buttons. */
export async function shownRule(
  locale: "en" | "zh",
  request: WebhookRuleRequest = testRuleRequest(),
): Promise<{ readonly card: readonly string[]; readonly receipt: string }> {
  const formatter = createFormatter({ locale, timeZone: "UTC" });
  const test = await startOrderEngine();
  const { intent } = await createdRule(test, request);
  const card = expectOk(await test.engine.handlers["intent/card"](testCall({ intent })));
  const display = { formatter, assets: card.assets };
  await tapCard(test, intent, "confirm");
  const live = { signal: new AbortController().signal };
  const record = await test.stores.intents.get(intent, live);
  const { orders, webhookRules, agents } = test.stores;
  const source = { orders, webhookRules, agents, chains: testChains() };
  const written =
    record === undefined ? undefined : await writtenReceiptOf({ ...source, record }, live);
  if (written === undefined) {
    throw new Error(`Expected the card of ${intent} to have its receipt.`);
  }
  const receipt = cardLineText(receiptAfterLine(written.outcome), display);
  return { card: card.lines.map((line) => cardLineText(line, display)), receipt };
}
