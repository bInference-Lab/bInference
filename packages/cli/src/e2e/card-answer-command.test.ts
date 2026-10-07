import type { Venue } from "@binference/chain";
import { createFakeVenue } from "@binference/chain/testing";
import {
  testAgent as agent,
  testCoin as coin,
  testNowMs,
  testToken as token,
  testWallet as wallet,
} from "@binference/engine/testing";
import { createFormatter, messages } from "@binference/i18n";
import { type IntentView, operations } from "@binference/protocol";
import { afterEach, describe, expect, it } from "vitest";
import { skeletonCompositions } from "../compose/test-skeleton.js";
import { type ServedSkeleton, serveSkeleton } from "./skeleton-machine.js";
import { createTestMachines, runOn, type TestMachine } from "./test-host.js";

const slow = { timeout: 60_000 };
const machines = createTestMachines();
const served: ServedSkeleton[] = [];
const english = createFormatter({ locale: "en", timeZone: "UTC" });
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
      const confirmed = await runOn(machine, ["confirm", proposed.intent]);
      expect(confirmed).toStrictEqual({
        code: 0,
        stdout:
          `Confirmed ${proposed.intent}. Paper fill: ${shown(1_000_000n, "FAKE")} → ` +
          `${shown(2_000_000n, "TKN")}.\n`,
        stderr: "",
      });
      const stored = await skeleton.client.call("intent/get", { intent: proposed.intent }, live());
      expect(stored.state).toBe("paper_filled");
      expect(skeleton.executor.taken()).toStrictEqual([]);
      const again = await runOn(machine, ["confirm", proposed.intent, "--json"]);
      expect(again).toMatchObject({ code: 1, stdout: '{"error":{"code":"intent.wrong_state"}}\n' });
    });

    it("prints the intent after the answer as JSON", slow, async () => {
      const { machine, skeleton } = await servedMachine();
      const proposed = await skeleton.client.call("intent/propose", swap(1_000_000n), live());
      const json = await runOn(machine, ["confirm", "--json", proposed.intent]);
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
        const reopened = await runOn(machine, ["confirm", proposed.intent]);
        expect(reopened).toStrictEqual({
          code: 1,
          stdout: "",
          stderr:
            `The price moved, so binference opened card version 2: ${shown(1_000_000n, "FAKE")} → ` +
            `at least ${shown(995_000n, "TKN")}. Check it, then run \`binference confirm ` +
            `${proposed.intent}\` again.\n`,
        });
        const confirmed = await runOn(machine, ["confirm", proposed.intent]);
        expect(confirmed.stdout).toBe(
          `Confirmed ${proposed.intent}. Paper fill: ${shown(1_000_000n, "FAKE")} → ` +
            `${shown(1_000_000n, "TKN")}.\n`,
        );
      },
    );

    it("refuses an intent the engine has no record of, or one without a card", slow, async () => {
      const { machine, skeleton } = await servedMachine();
      const unknown = await runOn(machine, ["confirm", unknownIntent]);
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

    it("refuses a command line without an intent id", slow, async () => {
      const machine = await machines.create(testNowMs);
      await expect(runOn(machine, ["confirm", "card-1"])).resolves.toMatchObject({
        code: 1,
        stdout: "",
      });
    });
  },
);
