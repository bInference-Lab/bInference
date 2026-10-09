import {
  type AccountRef,
  accountRefSchema,
  type Amount,
  type SimulatedStep,
} from "@binference/chain";
import { createFakeFamily } from "@binference/chain/testing";
import { type Id, idSchema } from "@binference/core";
import { type TestWallet, testWalletRecord } from "../install/test-wallet-record.js";
import type { RescueMove } from "../intents/rescue-quote.js";
import {
  testAgent,
  testAgentDraft,
  testCoin,
  testNowMs,
  testToken,
  testWallet,
} from "../intents/test-intents.js";
import { type TestEngine, testAccount } from "../operations/test-engine.js";
import { looseningWaitMs } from "../policy/send-level-change.js";

/** The owner's rescue address in the tests' install. */
export const testRescue: AccountRef = accountRefSchema.parse("fake:1:0x000000a1");
/** A second agent, whose one wallet a rescue empties too. */
export const secondAgent: Id<"agt"> = idSchema("agt").parse(
  "agt_0190f1c2-3a4b-7c5d-8e6f-0000000000a2",
);
/** The second agent's wallet. */
export const secondWallet: Id<"wal"> = idSchema("wal").parse(
  "wal_0190f1c2-3a4b-7c5d-8e6f-0000000000c2",
);
/** The second wallet's account on the fake chain. */
export const secondAccount: AccountRef = accountRefSchema.parse("fake:1:0x000000c2");
/** Custody's wallets beside the test wallet. */
export const rescueCustody: ReadonlyMap<Id<"wal">, AccountRef> = new Map([
  [secondWallet, secondAccount],
]);
/** The gas reserve of the test limits on the fake chain. */
export const testReserveBase: bigint = 10n ** 15n;

/** What the two wallets hold: the test wallet a coin and some of the token, the second half a coin. */
export const testHeld: ReadonlyMap<AccountRef, readonly Amount[]> = new Map([
  [
    testAccount,
    [
      { asset: testCoin, base: 10n ** 18n },
      { asset: testToken, base: 500n },
    ],
  ],
  [secondAccount, [{ asset: testCoin, base: 5n * 10n ** 17n }]],
]);

/** The moves a rescue of {@link testHeld} plans, in order: each token whole, the coin above the reserve. */
export const testMoves: readonly RescueMove[] = [
  { wallet: testWallet, from: testAccount, amount: { asset: testToken, base: 500n } },
  {
    wallet: testWallet,
    from: testAccount,
    amount: { asset: testCoin, base: 10n ** 18n - testReserveBase },
  },
  {
    wallet: secondWallet,
    from: secondAccount,
    amount: { asset: testCoin, base: 5n * 10n ** 17n - testReserveBase },
  },
];

/** The payload of a move's send to the rescue address on the fake chain. */
export function payloadOf(move: RescueMove): string {
  const draft = createFakeFamily().transferDraft({
    from: move.from,
    to: testRescue,
    amount: move.amount,
  });
  if (!draft.ok) {
    throw new Error("Expected a fake send.");
  }
  return draft.value.payload;
}

/** What each move but those `skipped` does on the fake chain: it sends its amount, as planned. */
export function rescueSteps(
  skipped: readonly RescueMove[] = [],
): ReadonlyMap<string, SimulatedStep> {
  const steps = testMoves
    .filter((move) => !skipped.includes(move))
    .map((move): readonly [string, SimulatedStep] => [
      payloadOf(move),
      {
        status: "success",
        gasUsed: 21_000n,
        transfers: [{ from: move.from, to: testRescue, amount: move.amount }],
        approvals: [],
      },
    ]);
  return new Map(steps);
}

/**
 * Sets the test engine's install up for a rescue: the rescue address in effect since two days, the
 * test wallet and a second agent with its wallet.
 */
export async function setUpRescue(test: TestEngine): Promise<void> {
  const live = { signal: new AbortController().signal };
  const atMs = testNowMs - 2 * looseningWaitMs;
  await test.stores.install.changeRescue(
    { address: testRescue, atMs: atMs - looseningWaitMs },
    live,
  );
  await test.stores.agents.create(testAgentDraft({ id: secondAgent, name: "second" }), live);
  const wallets: readonly TestWallet[] = [
    { id: testWallet, agentId: testAgent, label: "main", createdAtMs: atMs },
    { id: secondWallet, agentId: secondAgent, label: "second", createdAtMs: atMs + 1 },
  ];
  wallets.forEach((wallet) => test.stores.install.addWallet(testWalletRecord(wallet)));
}
