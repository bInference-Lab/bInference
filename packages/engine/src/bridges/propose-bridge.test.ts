import { type Bridge, chainRefSchema } from "@binference/chain";
import { fakeDepositAbi } from "@binference/chain/testing";
import { err, type Id, idSchema } from "@binference/core";
import { describe, expect, it } from "vitest";
import { testSnapshot } from "../approval/test-snapshot.js";
import { type BridgeIntentQuote, bridgeQuoteDocument } from "../intents/bridge-quote.js";
import { expectOk, testToken } from "../intents/test-intents.js";
import { testCardText } from "../money-path/test-launches.js";
import { testAccount, testCall, testCallers } from "../operations/test-engine.js";
import {
  type BridgeTest,
  bridgeEngine,
  bridgeLimits,
  testArrives,
  testBridge,
  testFarEntry,
  testOtherArrives,
  testRescue,
  testRescueThere,
  testRoute,
  testSpoke,
} from "./test-bridges.js";

const live = { signal: new AbortController().signal };

// The bridge quote the intent stored.
async function storedQuote(
  test: BridgeTest["test"],
  intent: Id<"int">,
): Promise<BridgeIntentQuote> {
  const stored = await test.stores.intents.get(intent, live);
  return bridgeQuoteDocument.decode(stored?.quote ?? null);
}

// The fake bridge with its deposit marked as a bridge wallet's alone, as Relay's is.
function onlyBridgeWallets(fake: BridgeTest["bridge"]): Bridge {
  return {
    ...fake,
    contracts: fake.contracts.map((entry) => ({
      chain: entry.chain,
      names: ["spoke"],
      calls: [
        {
          contract: "spoke",
          abi: fakeDepositAbi,
          walletInputs: ["depositor"],
          onlyWallet: "bridge" as const,
        },
      ],
    })),
  };
}

async function propose(
  test: Awaited<ReturnType<typeof bridgeEngine>>["test"],
  request = testBridge(),
) {
  return test.engine.handlers["intent/propose"](testCall(request));
}

describe("proposing a bridge", () => {
  it("leaves a bridge within every cap to the owner's tap in auto mode, from a clean runtime turn", async () => {
    const agent = { mode: "live", approvalMode: "auto", limits: bridgeLimits } as const;
    const { test } = await bridgeEngine({ agent });
    const caller = { ...testCallers.runtime, turn: { hasOutsideContent: false } };
    const view = expectOk(
      await test.engine.handlers["intent/propose"](testCall(testBridge(), caller)),
    );
    const { stored } = await testSnapshot(test, view.intent);
    expect([view.state, stored.status.authorizedBy]).toStrictEqual([
      "awaiting_confirmation",
      undefined,
    ]);
  });

  it("opens a card that names the entry, the least it receives there, the fees and the read", async () => {
    const { test } = await bridgeEngine();

    const view = expectOk(await propose(test));

    expect(view).toMatchObject({ kind: "bridge", state: "awaiting_confirmation" });
    expect(await storedQuote(test, view.intent)).toMatchObject({
      venue: "fake-cross",
      chainName: "Fake Two",
      amount: { asset: testToken, base: 100_000_000n },
      recipient: testFarEntry.account,
      recipientBytes: "0x000000b1",
      label: "exchange",
      minOut: { asset: testArrives, base: 99_000_000n },
      deposit: { kind: "bound", contract: testSpoke, destinationId: "2" },
    });
    expect((await testCardText(test, view, "en")).slice(1)).toStrictEqual([
      "Bridge 100 TKN to Fake Two · to exchange (0x000000b1) · about 1 min",
      "exchange (0x000000b1) receives at least 99 TKN on Fake Two",
      "Bridge fees 1 TKN · through fake-cross",
      "binference reads Fake Two to see it arrive, and tells you if it is late",
      'Agent says  "Move to the exchange"',
      expect.stringMatching(/^Expires/u),
    ]);
  });

  it("warns when the route delivers another token than the one sent", async () => {
    const route = { ...testRoute, arrives: testOtherArrives };
    const { test } = await bridgeEngine({ routes: [route] });

    const view = expectOk(await propose(test));

    expect(await testCardText(test, view, "en")).toContain(
      "⚠️ TKN arrives on Fake Two as TKG, a different token",
    );
  });

  it("pays the rescue address there only while it holds no code on either chain", async () => {
    const { test, codesThere } = await bridgeEngine();
    const plain = expectOk(await propose(test, testBridge({ rescue: true })));
    expect(plain.state).toBe("awaiting_confirmation");
    const quote = await storedQuote(test, plain.intent);
    expect([quote.recipient, quote.isRescue]).toStrictEqual([testRescueThere, true]);

    codesThere.place(testRescueThere, "delegation");
    const coded = expectOk(await propose(test, testBridge({ rescue: true })));
    expect([coded.state, coded.outcome?.reason]).toStrictEqual([
      "failed_check",
      "rescue_not_plain",
    ]);
    codesThere.down();
    const unread = expectOk(await propose(test, testBridge({ rescue: true })));
    expect(unread.outcome?.reason).toBe("recipient_unread");
  });

  it("refuses the rescue address on its own chain's code too", async () => {
    const { test, codesHere } = await bridgeEngine();
    codesHere.place(testRescue, "contract");
    const view = expectOk(await propose(test, testBridge({ rescue: true })));
    expect(view.outcome?.reason).toBe("rescue_not_plain");
  });

  it("refuses an entry a read finds to be a token's own contract", async () => {
    const { test, codesThere } = await bridgeEngine();
    codesThere.place(testFarEntry.account, "token");
    const view = expectOk(await propose(test));
    expect([view.state, view.outcome?.reason]).toStrictEqual([
      "failed_check",
      "recipient_not_wallet",
    ]);
  });

  it("ends a bridge to an entry a rule reaching its chain does not list, naming the chain", async () => {
    const { test } = await bridgeEngine({ bridged: [testRescueThere] });
    const view = expectOk(await propose(test));
    expect([view.state, view.outcome]).toStrictEqual([
      "failed_check",
      { reason: "ceiling_lacks_payee", chain: "Fake Two" },
    ]);
  });

  it("ends a bridge to a chain no bridge rule of the ceiling reaches", async () => {
    const { test } = await bridgeEngine({ bridged: [] });
    const view = expectOk(await propose(test));
    expect(view.outcome?.reason).toBe("bridge_chain_unpaid");
  });

  it("ends a bridge to a plain rescue address the ceiling lists on its own chain only", async () => {
    const { test } = await bridgeEngine({ bridged: [testFarEntry.account] });
    const view = expectOk(await propose(test, testBridge({ rescue: true })));
    expect(view.outcome?.reason).toBe("rescue_unpaid");
  });

  it("reads the payee before the ceiling, so a rescue address with code is never called unpaid", async () => {
    const { test, codesThere } = await bridgeEngine({ bridged: [] });
    codesThere.place(testRescueThere, "contract");
    const view = expectOk(await propose(test, testBridge({ rescue: true })));
    expect(view.outcome?.reason).toBe("rescue_not_plain");
  });

  it("ends a bridge past what the wallet holds", async () => {
    const held = new Map([[testAccount, [{ asset: testToken, base: 50_000_000n }]]]);
    const { test } = await bridgeEngine({ held });
    const view = expectOk(await propose(test));
    expect(view.outcome?.reason).toBe("nothing_to_sell");
  });

  it("refuses a bridge in paper mode by policy", async () => {
    const { test } = await bridgeEngine({ agent: { mode: "paper" } });
    const view = expectOk(await propose(test));
    expect([view.state, view.outcome?.reason]).toStrictEqual(["rejected_policy", "paper_only"]);
  });

  it("stores nothing for an unknown entry, an entry of another chain or no destination", async () => {
    const { test } = await bridgeEngine();
    const unknown = testBridge({
      entry: idSchema("adr").parse(testFarEntry.id.replace(/b1$/u, "b9")),
    });
    expect(await propose(test, unknown)).toStrictEqual(err("address.not_found"));
    const elsewhere = { ...testBridge(), toChain: chainRefSchema.parse("fake:9") };
    expect(await propose(test, elsewhere)).toStrictEqual(err("protocol.bad_args"));
    const listed = await test.stores.intents.list({ states: ["proposed"], limit: 10 }, live);
    expect(listed).toStrictEqual([]);
  });
});

describe("the wallet of a bridge venue's route", () => {
  it("refuses a route only a bridge wallet takes, for an agent with none, storing nothing", async () => {
    const base = await bridgeEngine();
    const { test } = await bridgeEngine({ bridge: onlyBridgeWallets(base.bridge) });
    const request = { ...testBridge() };
    const { wallet: _named, ...unnamed } = request;
    expect(await propose(test, unnamed)).toStrictEqual(err("intent.bridge_wallet_missing"));
    expect(await propose(test, request)).toStrictEqual(err("intent.bridge_wallet_only"));
    expect(await test.stores.intents.list({ states: ["proposed"], limit: 10 }, live)).toStrictEqual(
      [],
    );
  });
});
