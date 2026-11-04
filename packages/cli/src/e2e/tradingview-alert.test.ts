import type { ProtocolId } from "@binference/protocol";
import { afterEach, describe, expect, it } from "vitest";
import { skeletonCompositions } from "../compose/test-skeleton.js";
import {
  type AlertRuleMachine,
  chatTexts,
  confirmInTelegram,
  fillAfter,
  type MadeRule,
  makeRule,
  postAlert,
  startAlertRuleMachine,
} from "./alert-rule-machine.js";
import { runOn } from "./test-host.js";
import { tradingViewBuy, tradingViewSecondBuy } from "./tradingview-alerts.js";

// The webhook skeleton (gate Z8): the owner makes an alert rule with `binference webhook create`
// and confirms its card in Telegram (the synthetic Bot API); a TradingView alert posted to the
// webhook listener then fills the rule once on paper, inside its size, its slippage and the minute
// after the alert arrived, and the owner reads the fill in Telegram. The same alert again is a
// repeat (409) and a second alert inside the minute is over the rule's rate (429): neither fills,
// and the owner hears of neither (spec 4, section 4.4) but finds both in `binference webhook
// events`. An alert whose fill would start more than a minute after it arrived is skipped as late,
// and told. The fills run on the fake chain and venue: a paper fill needs no real venue's quote.

const slow = { timeout: 60_000 };
const live = (): { readonly signal: AbortSignal } => ({ signal: AbortSignal.timeout(10_000) });
const worlds: AlertRuleMachine[] = [];
const waiting = String.fromCodePoint(0x1f7e1);
const paper = String.fromCodePoint(0x1f9ea);
const done = String.fromCodePoint(0x2705);
const warning = String.fromCodePoint(0x26a0, 0xfe0f);

afterEach(async () => {
  await Promise.all(worlds.splice(0).map(async (world) => world.stop()));
});

// $20 of the fake chain's coin on each alert, at most 0.5% slippage, the test agent's own limit on
// a pair of registry tokens, and one alert a minute.
const create = [
  "webhook",
  "create",
  "--name",
  "BNB breakout",
  "--token",
  "TKN",
  "--side",
  "buy",
  "--usd",
  "20",
  "--slippage",
  "0.5",
  "--rate",
  "1",
];

// $20 of the fake chain's coin, at the skeleton's $600 a coin, in its base units.
const twentyDollarsOfCoin = 33_333_333_333_333_333n;

// The rule made in the CLI waits for its card, which reaches Telegram and leaves the URL refused
// until the owner's Confirm there turns the card into the rule's receipt.
async function confirmsInTelegram(world: AlertRuleMachine): Promise<MadeRule> {
  const rule = await makeRule(world, create);
  expect([rule.made.code, rule.made.stderr]).toStrictEqual([0, ""]);
  expect(rule.made.stdout).toContain("Its URL works once you confirm its card");
  expect(await postAlert(world, rule.url, tradingViewBuy)).toBe(404);
  expect(chatTexts(world)).toStrictEqual([
    [
      `${waiting} Confirm alert rule · main · ${paper} Paper`,
      'Approve alert rule "BNB breakout": buy TKN with $20.00 of FAKE on each alert · at most 1 a minute',
      "No fill limit until Feb 14, 2027, 08:00:00",
      "Each fill takes at most 0.50% slippage",
      "Its URL works once you confirm; anyone who has it can fire this rule inside its bounds",
      "It fills on paper only, even after this agent goes live: alert rules trade no live funds yet",
      `${paper} Paper mode: nothing is sent on chain`,
      "Expires at 08:10:00",
    ].join("\n"),
  ]);
  await confirmInTelegram(world);
  expect(chatTexts(world)).toStrictEqual([
    `${done} Alert rule "BNB breakout" active: buy TKN with $20.00 of FAKE on each alert · until Feb 14, 2027, 08:00:00`,
  ]);
  expect(world.botApi.messages()[0]?.buttons).toStrictEqual([]);
  return rule;
}

// The alert fills five seconds after it arrived: one paper buy of $20 of the coin that asks at
// most 0.5% slippage, and the owner reads it in Telegram. Answers the fill's intent.
async function fillsOnce(world: AlertRuleMachine, made: MadeRule): Promise<ProtocolId<"intent">> {
  const { client } = world.skeleton;
  expect(await postAlert(world, made.url, tradingViewBuy)).toBe(202);
  await fillAfter(world, 5_000);
  const [filled] = (await client.call("webhookRule/events", { rule: made.rule }, live())).items;
  const intent = filled?.intent ?? ("" as ProtocolId<"intent">);
  const fill = await client.call("intent/get", { intent }, live());
  expect([filled?.taken, filled?.fill, fill.state, fill.paper]).toStrictEqual([
    "accepted",
    "filled",
    "paper_filled",
    true,
  ]);
  expect(fill.request).toMatchObject({
    kind: "buy",
    spend: { base: twentyDollarsOfCoin },
    maxSlippageBps: 50,
  });
  expect(fill.createdAt - (filled?.receivedAt ?? 0)).toBe(5_000);
  expect(chatTexts(world).at(-1)).toBe(
    `main · ${paper} ${done} Alert rule "BNB breakout" filled: bought 66,666,666,666 TKN for $20.00 at $0.00000000029`,
  );
  return intent;
}

// The same alert again is a repeat, and the strategy's second alert inside the minute is over the
// rule's rate: neither fills nor reaches Telegram, and `webhook events` lists both as recorded.
async function refusesReplay(
  world: AlertRuleMachine,
  made: MadeRule & { readonly fill: ProtocolId<"intent"> },
): Promise<void> {
  const told = chatTexts(world);
  expect(await postAlert(world, made.url, tradingViewBuy)).toBe(409);
  expect(await postAlert(world, made.url, tradingViewSecondBuy)).toBe(429);
  await fillAfter(world, 1_000);
  expect(chatTexts(world)).toStrictEqual(told);
  const events = await runOn(world.machine, ["webhook", "events", made.rule], world.env);
  expect(events.stdout.split("\n")).toStrictEqual([
    `3 alerts to ${made.rule}, newest first:`,
    "  3 at Jan 15, 2027, 08:00:05: over the rule's rate, recorded only",
    "  2 at Jan 15, 2027, 08:00:05: a repeat of an alert before it, recorded only",
    `  1 at Jan 15, 2027, 08:00:00: filled on paper, intent ${made.fill}`,
    "",
  ]);
}

// An hour later the strategy's second alert is inside the rate, but its fill starts more than a
// minute after it arrived: it is skipped as late, and the owner is told.
async function skipsLate(world: AlertRuleMachine, made: MadeRule): Promise<void> {
  await world.skeleton.clock.advance(3_600_000);
  expect(await postAlert(world, made.url, tradingViewSecondBuy)).toBe(202);
  await fillAfter(world, 61_000);
  expect(chatTexts(world).at(-1)).toBe(
    `main · ${warning} Alert rule "BNB breakout" skipped an alert: it could not start within a minute of its time, so it is not made up later. The rule stays active.`,
  );
}

describe.each(skeletonCompositions)(
  "a TradingView alert to a webhook rule on the $name composition",
  (composition) => {
    it(
      "fills a rule made in the CLI and confirmed in Telegram once, and refuses its replay",
      slow,
      async () => {
        const world = await startAlertRuleMachine(composition, "en");
        worlds.push(world);
        const made = await confirmsInTelegram(world);
        const fill = await fillsOnce(world, made);
        await refusesReplay(world, { ...made, fill });
        await skipsLate(world, made);
        const rules = await runOn(world.machine, ["webhook", "list"], world.env);
        expect(rules.stdout).toContain(", 1 fill so far,");
      },
    );
  },
);
