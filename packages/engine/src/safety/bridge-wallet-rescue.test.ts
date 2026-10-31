import {
  type AccountRef,
  accountRefSchema,
  type Amount,
  assetRefSchema,
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
// The test agent's bridge wallet, which the owner funds from outside only (decision 0307), and an
// extra bridge wallet a rebuild adopted beside it.
const bridgeWallet = idSchema("wal").parse("wal_0190f1c2-3a4b-7c5d-8e6f-0000000000c7");
const bridgeAccount: AccountRef = accountRefSchema.parse("fake:1:0x000000c7");
const extraWallet = idSchema("wal").parse("wal_0190f1c2-3a4b-7c5d-8e6f-0000000000c8");
const extraAccount: AccountRef = accountRefSchema.parse("fake:1:0x000000c8");
// A token the registry does not list, which the bridge wallet holds a live position in.
const unlisted = assetRefSchema.parse("fake:1/token:0x0000000f");
const bridgeHeld: readonly Amount[] = [
  { asset: testCoin, base: 2n * 10n ** 17n },
  { asset: testToken, base: 300n },
  { asset: unlisted, base: 40n },
];
const extraHeld: readonly Amount[] = [{ asset: testCoin, base: 10n ** 17n }];
// What a rescue moves out of the bridge wallets: each token whole, the coin above the reserve.
const bridgeMoves: readonly RescueMove[] = [
  { wallet: bridgeWallet, from: bridgeAccount, amount: { asset: testToken, base: 300n } },
  { wallet: bridgeWallet, from: bridgeAccount, amount: { asset: unlisted, base: 40n } },
  {
    wallet: bridgeWallet,
    from: bridgeAccount,
    amount: { asset: testCoin, base: 2n * 10n ** 17n - testReserveBase },
  },
  {
    wallet: extraWallet,
    from: extraAccount,
    amount: { asset: testCoin, base: 10n ** 17n - testReserveBase },
  },
];

function stepOf(move: RescueMove): readonly [string, SimulatedStep] {
  const transfers = [{ from: move.from, to: testRescue, amount: move.amount }];
  return [payloadOf(move), { status: "success", gasUsed: 21_000n, transfers, approvals: [] }];
}

// Units of the unlisted token that arrived in the bridge wallet, opening its live position.
function unlistedArrival() {
  const position = {
    walletId: bridgeWallet,
    asset: unlisted,
    isPaper: false,
    quantityBase: 40n,
    costUsdMicros: 0n,
    realizedUsdMicros: 0n,
    changedAtMs: 1,
  };
  const received = { asset: unlisted, base: 40n };
  return {
    arrival: { walletId: bridgeWallet, isPaper: false, atMs: 1, received },
    positions: [{ position }],
  };
}

// The rescue's quote as the intent stores it.
async function quoteOf(test: TestEngine, intent: Id<"int">) {
  const record = await test.stores.intents.get(intent, live);
  if (record?.quote === undefined) {
    throw new Error(`Expected intent ${intent} to be quoted.`);
  }
  return rescueQuoteDocument.decode(record.quote);
}

describe("a rescue with bridge wallets", () => {
  it("empties the bridge wallet and an extra one, an unlisted token too, to the rescue address", async () => {
    const test = await startTestEngine({
      custodyWallets: new Map([
        ...rescueCustody,
        [bridgeWallet, bridgeAccount],
        [extraWallet, extraAccount],
      ]),
      held: new Map([...testHeld, [bridgeAccount, bridgeHeld], [extraAccount, extraHeld]]),
      chainSimulator: createFakeTxSimulator(
        new Map([...rescueSteps(), ...bridgeMoves.map(stepOf)]),
      ),
    });
    await setUpRescue(test);
    for (const [index, id] of [bridgeWallet, extraWallet].entries()) {
      const createdAtMs = testNowMs + index;
      test.stores.install.addWallet(
        testWalletRecord({ id, agentId: testAgent, label: "relays", createdAtMs, role: "bridge" }),
      );
    }
    expectOk(await test.positions.recordArrival(unlistedArrival(), live));

    const { intent } = expectOk(await test.engine.handlers["safety/rescue"](testCall({})));

    const quote = await quoteOf(test, intent);
    expect(quote.moves).toStrictEqual([...testMoves, ...bridgeMoves]);
    expect(quote.rescue).toBe(testRescue);
  });
});
