import { accountRefSchema, type AccountRef } from "@binference/chain";
import { type Id, idSchema } from "@binference/core";
import { describe, expect, it } from "vitest";
import { createMemoryEngineStores } from "../fakes/memory-engine-stores.js";
import type { IntentKind } from "../intents/intent-kind.js";
import type { IntentState } from "../intents/intent-state.js";
import { rescueQuoteDocument } from "../intents/rescue-quote.js";
import { sendQuoteDocument } from "../intents/send-quote.js";
import {
  testAgent,
  testAgentDraft,
  testCoin,
  testNowMs,
  testWallet,
} from "../intents/test-intents.js";
import { testSaved } from "../send-levels/test-sends.js";
import { payeeOf } from "./payee-of.js";

const live = { signal: new AbortController().signal };
const other = accountRefSchema.parse("fake:1:0x000000e1");
const rescue = accountRefSchema.parse("fake:1:0x000000a1");
const coin = { asset: testCoin, base: 1n };
const intentId = (n: number): Id<"int"> =>
  idSchema("int").parse(`int_0190f1c2-3a4b-7c5d-8e6f-${n.toString(16).padStart(12, "0")}`);

interface Planted {
  readonly kind: Extract<IntentKind, "send" | "rescue" | "buy">;
  readonly paid: AccountRef;
  readonly state?: IntentState;
  readonly isPaper?: boolean;
}

function quoteOf({ kind, paid }: Planted) {
  return kind === "send"
    ? sendQuoteDocument.encode({ amount: coin, recipient: paid, quotedAtMs: testNowMs })
    : rescueQuoteDocument.encode({
        rescue: paid,
        moves: [{ wallet: testWallet, from: other, amount: coin }],
        valueUsdMicros: 0n,
        quotedAtMs: testNowMs,
      });
}

// Settled trades that paid no one, as many as `count`.
function trades(count: number): readonly Planted[] {
  return Array.from({ length: count }, () => ({ kind: "buy", paid: other }));
}

async function payeeAfter(planted: readonly Planted[], account: AccountRef = testSaved.account) {
  const { intents, agents } = createMemoryEngineStores();
  await agents.create(testAgentDraft({ mode: "live" }), live);
  await Promise.all(
    planted.map(async (item, n) =>
      intents.create(
        {
          id: intentId(n + 1),
          agentId: testAgent,
          walletId: testWallet,
          kind: item.kind,
          state: item.state ?? "reconciled",
          request: {},
          ...(item.kind === "buy" ? {} : { quote: quoteOf(item) }),
          hasOutsideContent: false,
          isPaper: item.isPaper ?? false,
          proposer: "engine",
          atMs: testNowMs,
          cause: {},
        },
        live,
      ),
    ),
  );
  const settings = await agents.get(testAgent, live);
  if (settings === undefined) {
    throw new Error("Expected the test agent.");
  }
  return payeeOf(intents, { settings, account, rescueAccount: rescue }, live.signal);
}

describe("who a send pays", () => {
  it("is a new recipient until a live send or rescue of the agent settled there", async () => {
    await expect(payeeAfter([])).resolves.toStrictEqual({ isNewRecipient: true });
    await expect(payeeAfter([{ kind: "send", paid: testSaved.account }])).resolves.toStrictEqual(
      {},
    );
    await expect(payeeAfter([{ kind: "rescue", paid: rescue }], rescue)).resolves.toStrictEqual({
      isRescue: true,
    });
  });

  it("counts no send to another address, still under way, or on paper", async () => {
    const planted: readonly Planted[] = [
      { kind: "send", paid: other },
      { kind: "send", paid: testSaved.account, state: "executing" },
      { kind: "send", paid: testSaved.account, isPaper: true },
    ];
    await expect(payeeAfter(planted)).resolves.toStrictEqual({ isNewRecipient: true });
  });

  it("reads past a full page of settled intents to an older send, and no further than 20", async () => {
    const sent: Planted = { kind: "send", paid: testSaved.account };
    await expect(payeeAfter([...trades(500), sent])).resolves.toStrictEqual({});
    await expect(payeeAfter([...trades(10_000), sent])).resolves.toStrictEqual({
      isNewRecipient: true,
    });
  });
});
