import { accountRefSchema, type Amount } from "@binference/chain";
import type { FakeNameResolver } from "@binference/chain/testing";
import type { JsonValue } from "@binference/core";
import type { IntentRequest, IntentView, ProtocolErrorCode } from "@binference/protocol";
import { describe, expect, it } from "vitest";
import { fixtureId } from "../contracts/store-fixtures.js";
import { testWalletRecord } from "../install/test-wallet-record.js";
import { intentStates } from "../intents/intent-state.js";
import { revokeQuoteDocument } from "../intents/revoke-quote.js";
import { sendQuoteDocument } from "../intents/send-quote.js";
import { testCoin, testNowMs, testToken } from "../intents/test-intents.js";
import type { EngineCaller } from "../operations/engine-call.js";
import {
  startTestEngine,
  testCall,
  testCallers,
  type TestEngine,
  type TestEngineOptions,
} from "../operations/test-engine.js";
import { saveTestAddress, testSaved } from "../send-levels/test-sends.js";
import {
  testNames,
  testRevoke,
  testRouter,
  testSend,
  transferSimulator,
} from "./test-transfers.js";

const live = { signal: new AbortController().signal };
const coin: Amount = { asset: testCoin, base: 10n ** 15n };
const stranger = accountRefSchema.parse("fake:1:0x000000e1");
const prices = new Map([
  [testCoin, { numerator: 600n, denominator: 10n ** 12n }],
  [testToken, { numerator: 1n, denominator: 1n }],
]);

async function startSends(
  options: TestEngineOptions = {},
  names: FakeNameResolver = testNames(),
): Promise<TestEngine> {
  const test = await startTestEngine({
    agent: { mode: "live" },
    prices,
    nameResolvers: [names],
    chainSimulator: transferSimulator(
      [
        { to: testSaved.account, amount: coin },
        { to: testSaved.account, amount: { asset: testToken, base: 5n } },
      ],
      [{ token: testToken, spender: testRouter }],
    ),
    ...options,
  });
  await saveTestAddress(test);
  return test;
}

async function propose(
  test: TestEngine,
  request: IntentRequest,
  caller: EngineCaller = testCallers.cli,
): Promise<IntentView> {
  const proposed = await test.engine.handlers["intent/propose"](testCall(request, caller));
  if (!proposed.ok) {
    throw new Error(`Expected an intent, got ${proposed.error}.`);
  }
  return proposed.value;
}

async function refusal(test: TestEngine, request: IntentRequest): Promise<ProtocolErrorCode> {
  const proposed = await test.engine.handlers["intent/propose"](testCall(request));
  if (proposed.ok) {
    throw new Error(`Expected a refusal, got an intent in ${proposed.value.state}.`);
  }
  return proposed.error;
}

function ending(view: IntentView): readonly [string, string | undefined] {
  return [view.state, view.outcome?.reason];
}

async function storedQuote(test: TestEngine, view: IntentView) {
  const record = await test.stores.intents.get(view.intent, live);
  return record?.quote;
}

async function quoteOf(test: TestEngine, view: IntentView): Promise<JsonValue> {
  const quote = await storedQuote(test, view);
  if (quote === undefined) {
    throw new Error("Expected a quote.");
  }
  return quote;
}

async function sendQuoteOf(test: TestEngine, view: IntentView) {
  return sendQuoteDocument.decode(await quoteOf(test, view));
}

describe("a send", () => {
  it("opens a card for a saved address and stores its amount, its target and its value", async () => {
    const test = await startSends();
    const view = await propose(test, testSend());
    expect(ending(view)).toStrictEqual(["awaiting_confirmation", undefined]);
    expect(view.simulation).toMatchObject({ spent: [coin], received: [coin] });
    await expect(sendQuoteOf(test, view)).resolves.toStrictEqual({
      amount: coin,
      recipient: testSaved.account,
      quotedAtMs: testNowMs,
    });
    const record = await test.stores.intents.get(view.intent, live);
    expect(record?.valueUsdMicros).toBe(600_000n);
  });

  it("pays an address book entry on the wallet's chain", async () => {
    const view = await propose(await startSends(), testSend({ entry: testSaved.id }));
    expect(view.state).toBe("awaiting_confirmation");
  });

  it("refuses an unsaved address before any card, and an unknown entry before it stores anything", async () => {
    const test = await startSends();
    const view = await propose(test, testSend({ address: stranger }));
    expect(ending(view)).toStrictEqual(["rejected_policy", "unsaved_address"]);
    expect(view.card).toBeUndefined();
    const entry = fixtureId("adr", 2);
    await expect(refusal(test, testSend({ entry }))).resolves.toBe("address.not_found");
  });

  it("refuses an address on another chain, whatever it is", async () => {
    const elsewhere = accountRefSchema.parse("fake:2:0x000000f1");
    await expect(refusal(await startSends(), testSend({ address: elsewhere }))).resolves.toBe(
      "protocol.bad_args",
    );
  });

  it("refuses a launch or a bridge wallet of the install as its target", async () => {
    const test = await startSends();
    const launch = accountRefSchema.parse("fake:1:0x000000d1");
    const bridge = accountRefSchema.parse("fake:1:0x000000d2");
    const wallets = [
      { id: fixtureId("wal", 0xd1), address: "0x000000d1", role: "launch" },
      { id: fixtureId("wal", 0xd2), address: "0x000000d2", role: "bridge" },
    ] as const;
    wallets.forEach(({ id, address, role }) =>
      test.stores.install.addWallet({
        ...testWalletRecord({ id, agentId: testSaved.agentId, label: role, createdAtMs: 1, role }),
        address,
      }),
    );
    await expect(refusal(test, testSend({ address: launch }))).resolves.toBe(
      "address.launch_wallet",
    );
    await expect(refusal(test, testSend({ address: bridge }))).resolves.toBe(
      "address.bridge_wallet",
    );
  });

  it("counts against the per-trade cap, and refuses a token with no price, never at zero", async () => {
    const coinOnly = new Map([[testCoin, { numerator: 600n, denominator: 10n ** 12n }]]);
    const test = await startSends({ prices: coinOnly });
    const unpriced = await propose(test, testSend(undefined, { asset: testToken, base: 5n }));
    expect(ending(unpriced)).toStrictEqual(["rejected_policy", "no_price"]);
    const large = { asset: testCoin, base: 2n * 10n ** 18n };
    const over = await propose(test, testSend(undefined, large));
    expect(ending(over)).toStrictEqual(["rejected_policy", "per_trade_cap"]);
  });

  it("ends failed_check when its simulation reverts", async () => {
    const test = await startSends({ chainSimulator: transferSimulator([]) });
    const view = await propose(test, testSend());
    expect(ending(view)).toStrictEqual(["failed_check", "simulation_reverted"]);
  });

  it("is refused in paper mode before its name is read", async () => {
    const names = testNames();
    const test = await startSends({ agent: { mode: "paper" } }, names);
    const view = await propose(test, testSend({ name: "alice.bnb" }));
    expect(ending(view)).toStrictEqual(["rejected_policy", "paper_only"]);
    expect(names.reads()).toBe(0);
  });

  it("never runs in auto mode: its card asks why", async () => {
    const test = await startSends({ agent: { mode: "live", approvalMode: "auto" } });
    const view = await propose(test, testSend());
    expect(view.state).toBe("awaiting_confirmation");
  });

  it("refuses an unsaved address from an outside-content turn, with both reasons", async () => {
    const test = await startSends();
    const marked = { ...testCallers.runtime, turn: { hasOutsideContent: true } };
    const view = await propose(test, testSend({ address: stranger }), marked);
    expect(view.outsideContent).toBe(true);
    expect(view.outcome?.reason).toBe("unsaved_address");
  });
});

describe("a send by name", () => {
  it("resolves the name now, pays its saved address and keeps the name with it", async () => {
    const names = testNames();
    names.set("alice.bnb", { address: testSaved.account });
    const test = await startSends({}, names);
    const view = await propose(test, testSend({ name: "Alice.bnb" }));
    expect(view.state).toBe("awaiting_confirmation");
    await expect(sendQuoteOf(test, view)).resolves.toMatchObject({
      recipient: testSaved.account,
      name: { name: "alice.bnb", resolvedAtMs: testNowMs },
    });
  });

  it("keeps a smart-account wallet and a reverse record that names another name", async () => {
    const names = testNames();
    names.set("alice.bnb", {
      address: testSaved.account,
      isSmartAccount: true,
      reverse: { kind: "differs", other: "mallory.bnb" },
    });
    const test = await startSends({}, names);
    const view = await propose(test, testSend({ name: "alice.bnb" }));
    await expect(sendQuoteOf(test, view)).resolves.toMatchObject({
      name: { name: "alice.bnb", smartAccount: true, reverseOther: "mallory.bnb" },
    });
  });

  it("ends failed_check for a name with no address or a contract's, before anything is quoted", async () => {
    const names = testNames();
    names.set("vault.bnb", { address: testSaved.account, isContract: true });
    const test = await startSends({}, names);
    const nowhere = await propose(test, testSend({ name: "nobody.bnb" }));
    const contract = await propose(test, testSend({ name: "vault.bnb" }));
    expect([ending(nowhere), ending(contract)]).toStrictEqual([
      ["failed_check", "name_unresolved"],
      ["failed_check", "name_contract"],
    ]);
    expect(await storedQuote(test, contract)).toBeUndefined();
  });

  it("refuses a name that resolves to an unsaved address like any other", async () => {
    const names = testNames();
    names.set("bob.bnb", { address: stranger });
    const view = await propose(await startSends({}, names), testSend({ name: "bob.bnb" }));
    expect(ending(view)).toStrictEqual(["rejected_policy", "unsaved_address"]);
  });

  it("stores nothing when the name service does not answer, or no resolver serves the name", async () => {
    const names = testNames();
    names.down();
    const test = await startSends({}, names);
    await expect(refusal(test, testSend({ name: "alice.bnb" }))).resolves.toBe(
      "name.resolver_down",
    );
    await expect(refusal(test, testSend({ name: "alice.eth" }))).resolves.toBe("protocol.bad_args");
    const query = { states: intentStates, limit: 10 };
    await expect(test.stores.intents.list(query, live)).resolves.toHaveLength(0);
  });
});

describe("an approval revoke", () => {
  it("opens a card for a registry spender, and stores the token and the spender", async () => {
    const test = await startSends();
    const view = await propose(test, testRevoke(testToken));
    expect(ending(view)).toStrictEqual(["awaiting_confirmation", undefined]);
    expect(revokeQuoteDocument.decode(await quoteOf(test, view))).toStrictEqual({
      token: testToken,
      spender: testRouter,
      quotedAtMs: testNowMs,
    });
    const record = await test.stores.intents.get(view.intent, live);
    expect(record?.valueUsdMicros).toBe(0n);
  });

  it("ends failed_check for a spender the registry does not list, before the card", async () => {
    const view = await propose(await startSends(), testRevoke(testToken, stranger));
    expect(ending(view)).toStrictEqual(["failed_check", "spender_unlisted"]);
  });

  it("refuses the chain's coin, which has no allowance", async () => {
    await expect(refusal(await startSends(), testRevoke(testCoin))).resolves.toBe(
      "protocol.bad_args",
    );
  });

  it("is refused in paper mode", async () => {
    const view = await propose(
      await startSends({ agent: { mode: "paper" } }),
      testRevoke(testToken),
    );
    expect(ending(view)).toStrictEqual(["rejected_policy", "paper_only"]);
  });
});
