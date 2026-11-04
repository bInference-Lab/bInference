import { createWebhookIntake } from "@binference/engine/orders";
import { testAgent as agent, testNowMs } from "@binference/engine/testing";
import { createFormatter } from "@binference/i18n";
import type { WebhookRuleView } from "@binference/protocol";
import { afterEach, describe, expect, it } from "vitest";
import { skeletonCompositions } from "../compose/test-skeleton.js";
import { type ServedSkeleton, serveSkeleton } from "./skeleton-machine.js";
import { createTestMachines, runOn, type TestMachine } from "./test-host.js";

const slow = { timeout: 60_000 };
const machines = createTestMachines();
const served: ServedSkeleton[] = [];
const english = createFormatter({ locale: "en", timeZone: "UTC" });
const inZh = createFormatter({ locale: "zh", timeZone: "UTC" });
const live = (): { readonly signal: AbortSignal } => ({ signal: AbortSignal.timeout(10_000) });
const urlPattern = /(https?:\/\/\S+\/hook\/(whr_[^/\s]+)\/([\w-]{43}))/;

afterEach(async () => {
  await Promise.all(served.splice(0).map(async (skeleton) => skeleton.close()));
  await machines.removeAll();
});

// A rule that buys the test token with $20 on each alert, five a minute.
const create = ["webhook", "create", "--name", "BNB breakout", "--token", "TKN", "--side", "buy"];
const sized = [...create, "--usd", "20", "--rate", "5"];

/** The URL a command printed once, with its rule id and secret. */
function urlIn(stdout: string): {
  readonly url: string;
  readonly rule: string;
  readonly secret: string;
} {
  const [, url = "", rule = "", secret = ""] = urlPattern.exec(stdout) ?? [];
  return { url, rule, secret };
}

// What the webhook listener answers an alert with this text to the rule with this secret.
async function alertTo(
  skeleton: ServedSkeleton,
  at: { readonly rule: string; readonly secret: string },
  text: string,
): Promise<string> {
  const intake = createWebhookIntake({
    store: skeleton.parts.stores.webhookAlerts,
    clock: skeleton.clock,
    isLocked: () => false,
  });
  const body = new TextEncoder().encode(text);
  return intake.take({ ruleId: at.rule, secret: at.secret, body }, live());
}

describe.each(skeletonCompositions)(
  "binference webhook on the $name composition",
  (composition) => {
    async function servedMachine(): Promise<{ machine: TestMachine; skeleton: ServedSkeleton }> {
      const machine = await machines.create(testNowMs);
      const skeleton = await serveSkeleton(machine, composition);
      served.push(skeleton);
      await skeleton.client.call("portfolio/resetPaper", { agent }, live());
      return { machine, skeleton };
    }

    it(
      "makes a rule with its URL once and its card, then rotates it: the old URL is refused",
      slow,
      async () => {
        const { machine, skeleton } = await servedMachine();
        const made = await runOn(machine, [...sized, "--yes"]);
        expect([made.code, made.stderr]).toStrictEqual([0, ""]);
        const first = urlIn(made.stdout);
        expect(made.stdout).toContain(`Alert rule ${first.rule} waits for its card.`);
        expect(made.stdout).toContain('Approve alert rule "BNB breakout"');
        expect(made.stdout).toContain("The alert rule is active");
        expect(await alertTo(skeleton, first, "BNB up")).toBe("accepted");

        const listed = await runOn(machine, ["webhook", "list"]);
        expect(listed.stdout).toContain(`"BNB breakout" (${first.rule}): buy TKN with $20.00`);
        expect(listed.stdout).not.toContain(first.secret);

        const rotated = await runOn(machine, ["webhook", "rotate", first.rule]);
        const second = urlIn(rotated.stdout);
        expect([rotated.code, second.rule]).toStrictEqual([0, first.rule]);
        expect(second.secret).not.toBe(first.secret);
        expect(await alertTo(skeleton, first, "BNB down")).toBe("not_found");
        expect(await alertTo(skeleton, second, "BNB down")).toBe("accepted");

        const events = await runOn(machine, ["webhook", "events", first.rule]);
        expect(events.stdout).toContain(`2 alerts to ${first.rule}, newest first:`);
        expect(events.stdout).toContain(": waits for its fill");

        const deleted = await runOn(machine, ["webhook", "delete", first.rule]);
        expect(deleted.stdout).toBe(`Deleted alert rule ${first.rule}: its URL no longer works.\n`);
        expect(await alertTo(skeleton, second, "BNB flat")).toBe("not_found");
        const empty = await runOn(machine, ["webhook", "list"]);
        expect(empty.stdout).toBe("No alert rule is active or waits for its card.\n");
      },
    );

    it("leaves the card open with --json alone and prints the URL once as JSON", slow, async () => {
      const { machine, skeleton } = await servedMachine();
      const made = await runOn(machine, [...sized, "--json"]);
      expect(made.code).toBe(0);
      const { items } = await skeleton.client.call("webhookRule/list", {}, live());
      expect(items.map(({ state }) => state)).toStrictEqual(["awaiting_confirmation"]);
      const [rule] = items as [WebhookRuleView];
      const { url } = urlIn(made.stdout);
      expect(made.stdout).toBe(
        `${JSON.stringify({ rule: rule.rule, url, intent: rule.intent })}\n`,
      );
    });

    it("sizes a sale in the token's own decimals, with every bound as typed", slow, async () => {
      const { machine, skeleton } = await servedMachine();
      const bounds = ["--worst-price", "0.8", "--slippage", "0.5", "--max-fills", "3"];
      const sale = [...create.slice(0, 7), "sell", "--amount", "0.5", ...bounds, "--ttl", "7d"];
      const made = await runOn(machine, [...sale, "--json"]);
      expect(made.code).toBe(0);
      const { items } = await skeleton.client.call("webhookRule/list", {}, live());
      expect(items[0]?.request).toMatchObject({
        side: "sell",
        size: { base: 500_000n },
        worstPrice: 800_000n,
        maxSlippageBps: 50,
        maxFills: 3,
        expiresAt: testNowMs + 7 * 86_400_000,
      });
    });

    it(
      "refuses a missing size, an unknown token and a bad value before anything is stored",
      slow,
      async () => {
        const { machine, skeleton } = await servedMachine();
        const unsized = await runOn(machine, create);
        const unknown = await runOn(machine, [...sized.slice(0, 5), "NOPE", ...sized.slice(6)]);
        const badSlippage = await runOn(machine, [...sized, "--slippage", "half"]);
        expect([unsized.code, unknown.code, badSlippage.code]).toStrictEqual([1, 1, 1]);
        expect(unsized.stderr).toBe(`${english.message("cli.webhook.noSize")}\n`);
        expect(unknown.stderr).toContain("No token matches NOPE.");
        expect(badSlippage.stderr).toContain("--slippage does not take half");
        const { items } = await skeleton.client.call("webhookRule/list", {}, live());
        expect(items).toStrictEqual([]);
      },
    );

    it(
      "refuses a rule asking more slippage than the agent's limit, naming the next step",
      slow,
      async () => {
        const { machine, skeleton } = await servedMachine();
        const greedy = [...sized, "--slippage", "50", "--yes"];
        const refused = await runOn(machine, greedy);
        const inChinese = await runOn(machine, greedy, { LANG: "zh_CN.UTF-8" });
        const asJson = await runOn(machine, [...sized, "--slippage", "50", "--json"]);
        const key = "error.order.slippage_limit";
        expect([refused.code, refused.stdout]).toStrictEqual([1, ""]);
        expect(refused.stderr).toBe(`${english.message(key)}\n`);
        expect(refused.stderr).toContain("binference limit set limits.slippageBps.other=");
        expect(inChinese.stderr).toBe(`${inZh.message(key)}\n`);
        expect(asJson.stdout).toBe(`${JSON.stringify({ error: { code: key.slice(6) } })}\n`);
        const { items } = await skeleton.client.call("webhookRule/list", {}, live());
        expect(items).toStrictEqual([]);
      },
    );

    it("speaks Chinese to an owner who reads it", slow, async () => {
      const { machine } = await servedMachine();
      const made = await runOn(machine, [...sized, "--yes"], { LANG: "zh_CN.UTF-8" });
      const { rule } = urlIn(made.stdout);
      const [shownOnce] = inZh.message("cli.webhook.created", { rule, url: "" }).split("\n");
      expect(made.stdout).toContain(`${String(shownOnce)}\n`);
      const deleted = await runOn(machine, ["webhook", "delete", rule], { LANG: "zh_CN.UTF-8" });
      expect(deleted.stdout).toBe(`${inZh.message("cli.webhook.deleted", { rule })}\n`);
    });
  },
);
