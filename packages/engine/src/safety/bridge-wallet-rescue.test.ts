import {
  type AccountRef,
  accountRefSchema,
  type Amount,
  type SimulatedStep,
} from "@binference/chain";
import { createFakeTxSimulator } from "@binference/chain/testing";
import { type Id, idSchema } from "@binference/core";
import { describe, expect, it } from "vitest";
import { testWalletRecord } from "../install/test-wallet-record.js";
import { rescueQuoteDocument, type RescueMove } from "../intents/rescue-quote.js";
import { expectOk, testAgent, testCoin, testNowMs, testToken } from "../intents/test-intents.js";
import { startTestEngine, testCall, type TestEngine } from "../operations/test-engine.js";
import {
  payloadOf,
  rescueCustody,
  rescueSteps,
  setUpRescue,
  testHeld,
  testMoves,
  testRescue,
  testReserveBase,
} from "./test-rescue.js";

const live = { signal: new AbortController().signal };
// The test agent's bridge wallet, which the owner funds from outside only (decision 0307).
const bridgeWallet = idSchema("wal").parse("wal_0190f1c2-3a4b-7c5d-8e6f-0000000000c7");
const bridgeAccount: AccountRef = accountRefSchema.parse("fake:1:0x000000c7");
const bridgeHeld: readonly Amount[] = [
  { asset: testCoin, base: 2n * 10n ** 17n },
  { asset: testToken, base: 300n },
];
// What a rescue moves out of the bridge wallet: the token whole, the coin above the reserve.
const bridgeMoves: readonly RescueMove[] = [
  { wallet: bridgeWallet, from: bridgeAccount, amount: { asset: testToken, base: 300n } },
  {
    wallet: bridgeWallet,
    from: bridgeAccount,
    amount: { asset: testCoin, base: 2n * 10n ** 17n - testReserveBase },
  },
];

function stepOf(move: RescueMove): readonly [string, SimulatedStep] {
  const transfers = [{ from: move.from, to: testRescue, amount: move.amount }];
  return [payloadOf(move), { status: "success", gasUsed: 21_000n, transfers, approvals: [] }];
}

// The rescue's quote as the intent stores it.
async function quoteOf(test: TestEngine, intent: Id<"int">) {
  const record = await test.stores.intents.get(intent, live);
  if (record?.quote === undefined) {
    throw new Error(`Expected intent ${intent} to be quoted.`);
  }
  return rescueQuoteDocument.decode(record.quote);
}

describe("a rescue with a bridge wallet", () => {
  it("empties the bridge wallet with the other wallets, to the rescue address", async () => {
    const test = await startTestEngine({
      custodyWallets: new Map([...rescueCustody, [bridgeWallet, bridgeAccount]]),
      held: new Map([...testHeld, [bridgeAccount, bridgeHeld]]),
      chainSimulator: createFakeTxSimulator(
        new Map([...rescueSteps(), ...bridgeMoves.map(stepOf)]),
      ),
    });
    await setUpRescue(test);
    test.stores.install.addWallet(
      testWalletRecord({
        id: bridgeWallet,
        agentId: testAgent,
        label: "relays",
        createdAtMs: testNowMs,
        role: "bridge",
      }),
    );

    const { intent } = expectOk(await test.engine.handlers["safety/rescue"](testCall({})));

    const quote = await quoteOf(test, intent);
    expect(quote.moves).toStrictEqual([...testMoves, ...bridgeMoves]);
    expect(quote.rescue).toBe(testRescue);
  });
});
