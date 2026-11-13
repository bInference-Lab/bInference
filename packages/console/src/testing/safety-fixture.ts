import type { FakeAnswers } from "./fake-client";

// Two paper agents, main frozen by the owner and scout not, as `agent/list` and `safety/status`
// answer them, with the rescue address in effect and a new one that waits; the unfreeze card of
// main and the rescue card, as `intent/list` and `intent/card` answer them once opened.

const at = 1_800_000_000_000;
const day = 86_400_000;

/** The fixture's agents, intents, cards and addresses. */
export const safetyFixture = {
  main: "agt_0190f1c2-3a4b-7c5d-8e6f-000000000001",
  scout: "agt_0190f1c2-3a4b-7c5d-8e6f-000000000002",
  unfreezeIntent: "int_0190f1c2-3a4b-7c5d-8e6f-0000000000a1",
  unfreezeCard: "crd_0190f1c2-3a4b-7c5d-8e6f-0000000000a1",
  rescueIntent: "int_0190f1c2-3a4b-7c5d-8e6f-0000000000b1",
  rescueCard: "crd_0190f1c2-3a4b-7c5d-8e6f-0000000000b1",
  rescueAddress: "0x30435f9D276c6BC54F56161Fb3dFB7bDC2a8DBcB",
  newAddress: "0xeA6F82DbD6C87DE5E542eFbd1f9964879828e4e7",
  frozenAt: at,
  changesAt: at + day,
} as const;

const { main, scout, unfreezeIntent, unfreezeCard, rescueIntent, rescueCard } = safetyFixture;

const agentOf = (agent: string, name: string) => ({
  agent,
  name,
  mode: "paper",
  locale: "en",
  createdAt: at,
  changedAt: at,
});

/** `agent/list`: main and scout. */
export const agentList = { items: [agentOf(main, "main"), agentOf(scout, "scout")] };

/** `safety/status` with main frozen by the owner, the rescue address and a new one that waits. */
export const mainFrozen = {
  frozen: true,
  agents: [{ agent: main, frozenAt: at }],
  rescueAddress: `eip155:56:${safetyFixture.rescueAddress}`,
  pendingRescueAddress: `eip155:56:${safetyFixture.newAddress}`,
  pendingRescueAt: at + day,
};

/** `safety/status` with nothing frozen and the rescue address in effect. */
export const nothingFrozen = {
  frozen: false,
  rescueAddress: `eip155:56:${safetyFixture.rescueAddress}`,
};

const cardOf = (intent: string, card: string, kind: string) => ({
  intent,
  agent: main,
  kind,
  paper: false,
  card: { card, version: 1, opensAt: at, expiresAt: at + 600_000 },
});

const linesOf = (card: string, action: string, line: object) => ({
  card,
  version: 1,
  expiresAt: at + 600_000,
  assets: {},
  lines: [
    {
      key: "card.header",
      values: {
        action: { type: "choice", choice: action },
        agent: { type: "text", text: "main" },
        mode: { type: "choice", choice: "live" },
      },
    },
    line,
  ],
});

/** The unfreeze card of main, waiting for the owner's tap. */
export const unfreezeWaiting = cardOf(unfreezeIntent, unfreezeCard, "unfreeze");

/** The rescue card of every agent wallet, waiting for the owner's tap. */
export const rescueWaiting = cardOf(rescueIntent, rescueCard, "rescue");

/** `intent/card` of each waiting card: the unfreeze of main, and a rescue of two tokens. */
export const cardAnswers: FakeAnswers = {
  "intent/card": (args) =>
    "intent" in args && args.intent === unfreezeIntent
      ? linesOf(unfreezeCard, "unfreeze", {
          key: "card.unfreeze.agent",
          values: { agent: { type: "text", text: "main" } },
        })
      : linesOf(rescueCard, "rescue", {
          key: "card.rescue.action",
          values: {
            address: { type: "account", account: `eip155:56:${safetyFixture.rescueAddress}` },
            count: { type: "count", count: 2 },
            wallets: { type: "count", count: 1 },
            usd: { type: "usd", usdMicros: 120_500_000n },
          },
        }),
};
