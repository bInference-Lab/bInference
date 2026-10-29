import type { Venue } from "@binference/chain";
import { createFakeVenue } from "@binference/chain/testing";
import { bpsSchema } from "@binference/core";
import {
  testAgent as agent,
  testCoin as coin,
  testNowMs,
  testToken as token,
  testWallet as wallet,
} from "@binference/engine/testing";
import { createFormatter, messages } from "@binference/i18n";
import { type IntentView, operations, type ProtocolId } from "@binference/protocol";
import { afterEach, describe, expect, it } from "vitest";
import { skeletonCompositions } from "../compose/test-skeleton.js";
import { runCli } from "../program/run-cli.js";
import { createScriptedPrompter } from "../term/scripted-prompter.js";
import { type ServedSkeleton, serveSkeleton } from "./skeleton-machine.js";
import { createTestMachines, hostWith, runOn, type TestMachine } from "./test-host.js";

const slow = { timeout: 60_000 };
const machines = createTestMachines();
const served: ServedSkeleton[] = [];
const english = createFormatter({ locale: "en", timeZone: "UTC" });
const inZh = createFormatter({ locale: "zh", timeZone: "UTC" });
const en = (key: string, values: Readonly<Record<string, string>> = {}): string =>
  english.message(`cli.${key}`, values);
const live = (): { readonly signal: AbortSignal } => ({ signal: AbortSignal.timeout(10_000) });
const unknownIntent = "int_0190f1c2-3a4b-7c5d-8e6f-0000000000ff";

const swap = (base: bigint) =>
  ({
    kind: "swap",
    agent,
    wallet,
    reason: "Rotate into the token",
    from: coin,
    to: token,
    amount: { base },
  }) as const;

// A stop-loss that sells all the test token at $0.80, which opens a card.
const stopLoss = {
  kind: "stopLoss",
  agent,
  token,
  side: "sell",
  size: { percentBps: bpsSchema.parse(10_000) },
  trigger: { price: 800_000n },
  reason: "Protect the position",
} as const;

// The intent of a new stop-loss's card.
async function openedOrder(skeleton: ServedSkeleton): Promise<ProtocolId<"intent">> {
  const { intent } = await skeleton.client.call("order/create", stopLoss, live());
  if (intent === undefined) {
    throw new Error("Expected the order to open a card.");
  }
  return intent;
}

// The fake venue at 2 tokens a coin, until `worsen` drops it to 1.
function movingVenue(): { readonly venue: Venue; readonly worsen: () => void } {
  const rates = { current: createFakeVenue() };
  const base = createFakeVenue();
  return {
    venue: { ...base, quote: async (request, options) => rates.current.quote(request, options) },
    worsen: () => {
      rates.current = createFakeVenue({ rate: { numerator: 1n, denominator: 1n } });
    },
  };
}

// As an amount of the test coin (18 decimals) or token (6 decimals) shows.
function shown(base: bigint, symbol: "FAKE" | "TKN"): string {
  return `${english.tokenAmount(base, symbol === "FAKE" ? 18 : 6)} ${symbol}`;
}

afterEach(async () => {
  await Promise.all(served.splice(0).map(async (skeleton) => skeleton.close()));
  await machines.removeAll();
});

describe.each(skeletonCompositions)(
  "binference confirm and deny on the $name composition",
  (composition) => {
    async function servedMachine(venue?: Venue) {
      const machine: TestMachine = await machines.create(testNowMs);
      const skeleton = await serveSkeleton(
        machine,
        composition,
        venue === undefined ? {} : { venues: [venue] },
      );
      served.push(skeleton);
      await skeleton.client.call("portfolio/resetPaper", { agent }, live());
      return { machine, skeleton };
    }

    it("confirms a paper swap from the terminal and shows its paper fill", slow, async () => {
      const { machine, skeleton } = await servedMachine();
      const proposed = await skeleton.client.call("intent/propose", swap(1_000_000n), live());
      const confirmed = await runOn(machine, ["confirm", proposed.intent, "--yes"]);
      expect([confirmed.code, confirmed.stderr]).toStrictEqual([0, ""]);
      expect(confirmed.stdout).toContain(`Sell ${shown(1_000_000n, "FAKE")} → at least`);
      expect(
        confirmed.stdout.endsWith(
          `\nConfirmed ${proposed.intent}. Paper fill: ${shown(1_000_000n, "FAKE")} → ` +
            `${shown(2_000_000n, "TKN")}.\n`,
        ),
      ).toBe(true);
      const stored = await skeleton.client.call("intent/get", { intent: proposed.intent }, live());
      expect(stored.state).toBe("paper_filled");
      expect(skeleton.executor.taken()).toStrictEqual([]);
      const again = await runOn(machine, ["confirm", proposed.intent, "--json", "--yes"]);
      expect(again).toMatchObject({ code: 1, stdout: '{"error":{"code":"intent.wrong_state"}}\n' });
    });

    it("says an auto order is active once its card is confirmed, never sending", slow, async () => {
      const { machine, skeleton } = await servedMachine();
      const first = await openedOrder(skeleton);
      const second = await openedOrder(skeleton);
      const inEnglish = await runOn(machine, ["confirm", first, "--yes"]);
      const inChinese = await runOn(machine, ["confirm", second, "--yes"], {
        LANG: "zh_CN.UTF-8",
      });
      expect([inEnglish.code, inChinese.code]).toStrictEqual([0, 0]);
      expect(inEnglish.stdout).toContain(`\nConfirmed ${first}. The auto order is active.\n`);
      const activeInZh = inZh.message("cli.confirm.order", { intent: second, state: "active" });
      expect(inChinese.stdout).toContain(`\n${activeInZh}\n`);
      const orders = await skeleton.client.call("order/list", { agent, limit: 10 }, live());
      expect(orders.items.map(({ state }) => state)).toStrictEqual(["active", "active"]);
    });

    it("shows why auto mode asks, in the owner's language", slow, async () => {
      const { machine, skeleton } = await servedMachine();
      await skeleton.client.call("approval/set", { agent, mode: "auto" }, live());
      const first = await skeleton.client.call("intent/propose", swap(1_000_000n), live());
      const second = await skeleton.client.call("intent/propose", swap(1_000_000n), live());
      const inEnglish = await runOn(machine, ["confirm", first.intent, "--yes"]);
      const inChinese = await runOn(machine, ["confirm", second.intent, "--yes"], {
        LANG: "zh_CN.UTF-8",
      });
      expect(inEnglish.stdout).toContain("\nAuto mode asks you here: proposed from cli\n");
      const why = inZh.message("autoAsks.mcp", { client: "cli" });
      expect(inChinese.stdout).toContain(`\n${inZh.message("card.warn.autoAsks", { why })}\n`);
    });

    it("prints the intent after the answer as JSON", slow, async () => {
      const { machine, skeleton } = await servedMachine();
      const proposed = await skeleton.client.call("intent/propose", swap(1_000_000n), live());
      const json = await runOn(machine, ["confirm", "--json", "--yes", proposed.intent]);
      const view: IntentView = operations["intent/get"].result.parse(JSON.parse(json.stdout));
      expect([json.code, view.intent, view.state]).toStrictEqual([
        0,
        proposed.intent,
        "paper_filled",
      ]);
    });

    it("cancels a card from the terminal, and refuses a second answer", slow, async () => {
      const { machine, skeleton } = await servedMachine();
      const proposed = await skeleton.client.call("intent/propose", swap(1_000_000n), live());
      await expect(runOn(machine, ["deny", proposed.intent])).resolves.toStrictEqual({
        code: 0,
        stdout: `Cancelled ${proposed.intent}. Nothing was sent.\n`,
        stderr: "",
      });
      const stored = await skeleton.client.call("intent/get", { intent: proposed.intent }, live());
      expect(stored.state).toBe("denied");
      const chinese = await runOn(machine, ["deny", proposed.intent], { LANG: "zh_CN.UTF-8" });
      expect(chinese).toStrictEqual({
        code: 1,
        stdout: "",
        stderr: `${String(messages.zh["error.intent.wrong_state"])}\n`,
      });
    });

    it(
      "opens the next card version on a worse re-quote, and confirms it once checked",
      slow,
      async () => {
        const moving = movingVenue();
        const { machine, skeleton } = await servedMachine(moving.venue);
        const proposed = await skeleton.client.call("intent/propose", swap(1_000_000n), live());
        moving.worsen();
        // Past the agent's re-quote age, so a Confirm quotes again and meets the worse price.
        await skeleton.clock.advance(11_000);
        const reopened = await runOn(machine, ["confirm", proposed.intent, "--yes"]);
        expect(reopened.stdout).toContain(`Sell ${shown(1_000_000n, "FAKE")} → at least`);
        expect({ ...reopened, stdout: "" }).toStrictEqual({
          code: 1,
          stdout: "",
          stderr:
            `The price moved, so binference opened card version 2: ${shown(1_000_000n, "FAKE")} → ` +
            `at least ${shown(995_000n, "TKN")}. Check it, then run \`binference confirm ` +
            `${proposed.intent}\` again.\n`,
        });
        const confirmed = await runOn(machine, ["confirm", proposed.intent, "--yes"]);
        expect(confirmed.stdout).toContain(`at least ${shown(995_000n, "TKN")}`);
        expect(confirmed.stdout).toContain(
          `\nConfirmed ${proposed.intent}. Paper fill: ${shown(1_000_000n, "FAKE")} → ` +
            `${shown(1_000_000n, "TKN")}.\n`,
        );
      },
    );

    it("refuses an intent the engine has no record of, or one without a card", slow, async () => {
      const { machine, skeleton } = await servedMachine();
      const unknown = await runOn(machine, ["confirm", unknownIntent, "--yes"]);
      expect(unknown).toStrictEqual({
        code: 1,
        stdout: "",
        stderr: `${String(messages.en["error.intent.not_found"])}\n`,
      });
      // Far past the per-trade cap: refused by the policy before any card opens.
      const refused = await skeleton.client.call("intent/propose", swap(10n ** 30n), live());
      expect([refused.state, refused.card]).toStrictEqual(["rejected_policy", undefined]);
      const json = await runOn(machine, ["deny", refused.intent, "--json"]);
      expect(json).toMatchObject({ code: 1, stdout: '{"error":{"code":"intent.wrong_state"}}\n' });
    });

    it("shows the card and asks, and leaves it open on a no", slow, async () => {
      const { machine, skeleton } = await servedMachine();
      const proposed = await skeleton.client.call("intent/propose", swap(1_000_000n), live());
      const answered = async (answers: readonly string[]) => {
        const prompter = createScriptedPrompter({ confirm: answers });
        const host = hostWith(machine, ["confirm", proposed.intent], {
          env: {},
          parts: { prompter },
        });
        const code = await runCli(host);
        return { code, stdout: host.stdout(), prompter };
      };

      const left = await answered(["maybe", "no"]);
      const stored = await skeleton.client.call("intent/get", { intent: proposed.intent }, live());
      const confirmed = await answered(["YES"]);

      expect([left.code, stored.state]).toStrictEqual([1, "awaiting_confirmation"]);
      expect(left.stdout).toContain(`Sell ${shown(1_000_000n, "FAKE")} → at least`);
      expect(left.stdout).toContain(en("confirm.notConfirmed", { intent: proposed.intent }));
      expect(left.prompter.transcript.lines).toStrictEqual([en("confirm.yesOrNo")]);
      expect(confirmed.code).toBe(0);
      expect(confirmed.stdout).toContain(`Confirmed ${proposed.intent}. Paper fill:`);
    });

    it("refuses to confirm without a terminal unless --yes", slow, async () => {
      const { machine, skeleton } = await servedMachine();
      const proposed = await skeleton.client.call("intent/propose", swap(1_000_000n), live());

      const refused = await runOn(machine, ["confirm", proposed.intent]);
      const stored = await skeleton.client.call("intent/get", { intent: proposed.intent }, live());

      expect(refused).toStrictEqual({
        code: 1,
        stdout: "",
        stderr: `${en("confirm.needsTerminal", { intent: proposed.intent })}\n`,
      });
      expect(stored.state).toBe("awaiting_confirmation");
    });

    it("refuses a command line without an intent id", slow, async () => {
      const machine = await machines.create(testNowMs);
      await expect(runOn(machine, ["confirm", "card-1"])).resolves.toMatchObject({
        code: 1,
        stdout: "",
      });
    });
  },
);
