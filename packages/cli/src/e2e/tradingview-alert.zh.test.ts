import { afterEach, describe, expect, it } from "vitest";
import { skeletonCompositions } from "../compose/test-skeleton.js";
import {
  type AlertRuleMachine,
  chatTexts,
  confirmInTelegram,
  fillAfter,
  makeRule,
  postAlert,
  startAlertRuleMachine,
} from "./alert-rule-machine.js";
import { tradingViewBuy } from "./tradingview-alerts.js";

// The webhook skeleton for an owner who reads Chinese: the rule made in the CLI, confirmed in
// Telegram and filled by a TradingView alert, told in Chinese in the owner's chat.

const slow = { timeout: 60_000 };
const worlds: AlertRuleMachine[] = [];
const paper = String.fromCodePoint(0x1f9ea);
const done = String.fromCodePoint(0x2705);

afterEach(async () => {
  await Promise.all(worlds.splice(0).map(async (world) => world.stop()));
});

const create = ["webhook", "create", "--name", "BNB breakout", "--token", "TKN", "--side", "buy"];

describe.each(skeletonCompositions)(
  "a TradingView alert to a webhook rule in Chinese on the $name composition",
  (composition) => {
    it("tells the rule's receipt and its fill in Chinese", slow, async () => {
      const world = await startAlertRuleMachine(composition, "zh");
      worlds.push(world);
      const { url } = await makeRule(world, [...create, "--usd", "20", "--rate", "1"]);
      await confirmInTelegram(world);
      expect(await postAlert(world, url, tradingViewBuy)).toBe(202);
      await fillAfter(world, 5_000);
      expect(chatTexts(world)).toStrictEqual([
        `${done} 提醒规则“BNB breakout”已生效：每次提醒时用价值 $20.00 的 FAKE 买入 TKN，截至 2027年2月14日 08:00:00`,
        `main · ${paper} ${done} 提醒规则“BNB breakout”已成交：以 $0.00000000029 用 $20.00 买入 66,666,666,666 TKN`,
      ]);
    });
  },
);
