import { bscToken } from "@binference/chain-evm/fork";
import type { Id } from "@binference/core";
import { describe, expect, it } from "vitest";
import {
  confirmedOrder,
  type FillFixture,
  type FillRig,
  fillAgent,
  onFillFork,
  spa,
  xvs,
} from "./order-fill-rig.js";

const live = (): { readonly signal: AbortSignal } => ({ signal: AbortSignal.timeout(30_000) });
// A dollar a whole token of 18 decimals, as a confirmed price reads it: it meets the order's level.
const dollarOf = (token: FillRig["token"]) => ({
  token,
  usdPerBaseUnit: { numerator: 1n, denominator: 10n ** 12n },
  decimals: 18,
  isThin: false,
});

// A limit buy of the rig's token for 0.02 BNB, confirmed, then filled as a price fires it. Its
// worst price, a million dollars a token, leaves the risk step and the simulation to judge it.
async function limitBuy(rig: FillRig, signal: AbortSignal) {
  const order = await confirmedOrder(
    rig,
    {
      kind: "limit",
      agent: fillAgent,
      token: rig.token,
      side: "buy",
      size: { base: 2n * 10n ** 16n },
      trigger: { price: 1n, direction: "above" },
      worstPrice: 10n ** 12n,
      reason: "Buy the token once it trades above a micro-dollar",
    },
    signal,
  );
  const outcomes = await rig.engine.seePrice(dollarOf(rig.token), { signal });
  const outcome = outcomes.find((fired) => fired.order === order)?.outcome;
  return { order, outcome };
}

// What the rig stored and told of an order's fill.
async function reportOf(rig: FillRig, order: Id<"ord">) {
  const [row] = await rig.stores.orders.fills({ orderId: order, limit: 5 }, live());
  const states = ["failed_check", "risk_blocked", "paper_filled"] as const;
  const intents = await rig.stores.intents.list({ states: [...states], limit: 5 }, live());
  const state = (await rig.stores.orders.get(order, live()))?.state;
  const notices = rig.pushes.filter(({ topic }) => topic === "notice").map(({ data }) => data);
  return { row, intents, state, notices };
}

const honeypot: FillFixture = { token: spa, via: bscToken("USDT"), flags: [] };
const flagged: FillFixture = { token: xvs, flags: ["honeypot"] };

describe("auto order fills on a BSC fork", () => {
  it("skips a limit buy of a honeypot whose buy takes back part of what it bought, and says why", async ({
    signal,
  }) =>
    onFillFork(signal, honeypot, async (rig) => {
      const { order, outcome } = await limitBuy(rig, signal);
      const { row, intents, state, notices } = await reportOf(rig, order);

      expect(outcome).toBe("skipped");
      expect(intents).toMatchObject([
        { kind: "buy", state: "failed_check", reason: "effects_differ" },
      ]);
      expect(row).toMatchObject({
        outcome: "skipped",
        reason: "effects_differ",
        intentId: intents[0]?.id,
      });
      expect(state).toBe("active");
      expect(notices).toMatchObject([
        { key: "notice.skipped", parts: { reason: { key: "reason.effects_differ" } } },
      ]);
    }));

  it("skips a limit buy at the risk step when the token's source finds a honeypot, and says why", async ({
    signal,
  }) =>
    onFillFork(signal, flagged, async (rig) => {
      const { order, outcome } = await limitBuy(rig, signal);
      const { row, intents, state, notices } = await reportOf(rig, order);

      expect(outcome).toBe("skipped");
      expect(intents).toMatchObject([{ kind: "buy", state: "risk_blocked", reason: "honeypot" }]);
      expect(row).toMatchObject({
        outcome: "skipped",
        reason: "honeypot",
        intentId: intents[0]?.id,
      });
      expect(state).toBe("active");
      expect(notices).toMatchObject([
        { key: "notice.skipped", parts: { reason: { key: "reason.honeypot" } } },
      ]);
    }));
});
