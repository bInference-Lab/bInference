import {
  type AccountRef,
  accountRefSchema,
  type Amount,
  type AssetRef,
  assetRefParts,
  chainRefSchema,
  type SimulatedStep,
  type TxSimulator,
} from "@binference/chain";
import {
  createFakeFamily,
  createFakeNameResolver,
  createFakeTxSimulator,
  type FakeNameResolver,
} from "@binference/chain/testing";
import type { IntentRequest } from "@binference/protocol";
import { testAgent, testCoin, testToken, testWallet } from "../intents/test-intents.js";
import { testCardText } from "../money-path/test-launches.js";
import {
  startTestEngine,
  testAccount,
  testCall,
  type TestEngine,
} from "../operations/test-engine.js";
import { saveTestAddress, testSaved } from "../send-levels/test-sends.js";

/** The fake chain's router, a contract the registry lists, which an approval may name. */
export const testRouter: AccountRef = accountRefSchema.parse("fake:1:0x0000000b");

/** A `.bnb` name resolver on the fake chain, whose records each test sets. */
export function testNames(): FakeNameResolver {
  return createFakeNameResolver({ chain: chainRefSchema.parse("fake:1"), suffix: ".bnb" });
}

/** A send of `base` of an asset, the coin by default, from the test wallet to `to`. */
export function testSend(
  to: Extract<IntentRequest, { kind: "send" }>["to"] = { address: testSaved.account },
  amount: Amount = { asset: testCoin, base: 10n ** 15n },
): IntentRequest {
  return { kind: "send", agent: testAgent, wallet: testWallet, reason: "Pay the rent", amount, to };
}

/** An approval revoke of the token's allowance for `spender`, from the test wallet. */
export function testRevoke(token: AssetRef, spender: AccountRef = testRouter): IntentRequest {
  return {
    kind: "revokeApproval",
    agent: testAgent,
    wallet: testWallet,
    reason: "Clear an old approval",
    token,
    spender,
  };
}

function payloadOf(
  draft: ReturnType<ReturnType<typeof createFakeFamily>["transferDraft"]>,
): string {
  if (!draft.ok) {
    throw new Error("Expected a fake draft.");
  }
  return draft.value.payload;
}

/**
 * A simulator under which each send from the test wallet to one of `to` moves its amount there,
 * and each approval of `spenders` back to 0 sets that allowance; any other draft reverts.
 */
export function transferSimulator(
  sends: readonly { readonly to: AccountRef; readonly amount: Amount }[],
  revokes: readonly { readonly token: AssetRef; readonly spender: AccountRef }[] = [],
): Pick<TxSimulator, "simulate"> {
  const family = createFakeFamily();
  const sent = sends.map(({ to, amount }): readonly [string, SimulatedStep] => [
    payloadOf(family.transferDraft({ from: testAccount, to, amount })),
    {
      status: "success",
      gasUsed: 21_000n,
      transfers: [{ from: testAccount, to, amount }],
      approvals: [],
    },
  ]);
  const freed = revokes.map(({ token, spender }): readonly [string, SimulatedStep] => {
    const contract = accountRefSchema.parse(`fake:1:${assetRefParts(token).assetReference}`);
    const draft = family.approvalDraft({
      from: testAccount,
      token: contract,
      spender,
      amountBase: 0n,
    });
    const approval = { owner: testAccount, spender, amount: { asset: token, base: 0n } };
    return [
      payloadOf(draft),
      { status: "success", gasUsed: 30_000n, transfers: [], approvals: [approval] },
    ];
  });
  return createFakeTxSimulator(new Map([...sent, ...freed]));
}

/** The card a proposal opens, line by line, in one language. */
export async function transferCard(
  test: TestEngine,
  request: IntentRequest,
  locale: "en" | "zh",
): Promise<readonly string[]> {
  const proposed = await test.engine.handlers["intent/propose"](testCall(request));
  if (!proposed.ok) {
    throw new Error(`Expected an intent, got ${proposed.error}.`);
  }
  return testCardText(test, proposed.value, locale);
}

/** A live engine whose name `alice.bnb` points to the saved address, a smart-account wallet. */
export async function aliceEngine(reverse = true): Promise<TestEngine> {
  const names = testNames();
  names.set("alice.bnb", {
    address: testSaved.account,
    isSmartAccount: true,
    ...(reverse ? { reverse: { kind: "differs", other: "mallory.bnb" } } : {}),
  });
  const test = await startTestEngine({
    agent: { mode: "live" },
    nameResolvers: [names],
    chainSimulator: transferSimulator(
      [{ to: testSaved.account, amount: { asset: testCoin, base: 10n ** 15n } }],
      [{ token: testToken, spender: testRouter }],
    ),
  });
  await saveTestAddress(test);
  return test;
}
