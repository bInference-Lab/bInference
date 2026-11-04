import { idSchema } from "@binference/core";
import type { LaunchTokenRequest } from "@binference/protocol";
import { describe, expect, it } from "vitest";
import type { CardRecord } from "../intents/card-record.js";
import { requestDocument } from "../intents/intent-documents.schema.js";
import type { IntentRecord } from "../intents/intent-record.js";
import { testCoin, testNowMs, testToken, testWallet } from "../intents/test-intents.js";
import { type TokenLaunchQuote, tokenLaunchQuoteDocument } from "../intents/token-launch-quote.js";
import { testLaunch } from "../money-path/test-launches.js";
import { startTestEngine, testChains } from "../operations/test-engine.js";
import { sha256Hex } from "../records/sha256-hex.js";
import { cardFactsOf } from "./card-facts-of.js";
import { present } from "./test-venues.js";

const live = { signal: new AbortController().signal };
const intentId = idSchema("int").parse("int_0190f1c2-3a4b-7c5d-8e6f-000000000009");

const quote: TokenLaunchQuote = {
  venue: testLaunch.venue,
  settings: [],
  token: testToken,
  tokenDecimals: 18,
  fee: { asset: testCoin, base: 10n },
  pinWaitUntilMs: testNowMs,
  quotedAtMs: testNowMs,
};

const digest = sha256Hex("the uploaded picture");
const card: CardRecord = {
  id: idSchema("crd").parse("crd_0190f1c2-3a4b-7c5d-8e6f-000000000009"),
  intentId,
  version: 1,
  termsHash: sha256Hex("the launch's terms"),
  callbackRef: "ref-launch",
  openedAtMs: testNowMs,
  expiresAtMs: testNowMs + 600_000,
};

// The facts of a launch card drawn from its request and quote, for the test agent.
async function launchFacts(
  request: LaunchTokenRequest,
  launched: TokenLaunchQuote,
  roleWallet?: { readonly role: "launch"; readonly label: string },
) {
  const test = await startTestEngine();
  const settings = present(await test.stores.agents.get(testLaunch.agent, live));
  const record: IntentRecord = {
    id: intentId,
    agentId: testLaunch.agent,
    walletId: testWallet,
    kind: "launchToken",
    state: "awaiting_confirmation",
    request: requestDocument.encode(request),
    quote: tokenLaunchQuoteDocument.encode(launched),
    hasOutsideContent: false,
    isPaper: false,
    proposer: "telegram",
    createdAtMs: testNowMs,
    changedAtMs: testNowMs,
    version: 3,
  };
  return present(
    cardFactsOf({
      record,
      card,
      settings,
      isFirstLive: false,
      chains: testChains(),
      venues: { hasNoDeadline: () => false },
      client: "",
      ...(roleWallet === undefined ? {} : { roleWallet }),
    }),
  );
}

describe("a token launch's card facts", () => {
  it("show a launch with no first buy as buying none of its pair, with no least out", async () => {
    const { firstBuy: _buy, description: _words, ...bare } = testLaunch;
    const facts = await launchFacts(bare, quote);
    expect(facts.action).toMatchObject({
      kind: "launchToken",
      firstBuy: { asset: testCoin, base: 0n },
    });
    expect(facts.action).not.toHaveProperty("details.firstBuyMinOut");
    expect(facts.action).not.toHaveProperty("details.description");
  });

  it("show the least a first buy gets of the new token, the description and the uploaded picture", async () => {
    const image = {
      contentType: "image/png",
      bytes: 2_048,
      sha256: digest,
      width: 512,
      height: 512,
    } as const;
    const spend = { asset: testCoin, base: 1_000_000n };
    const firstBuy = { spend, expectedOut: 90n, minOut: 80n };
    const facts = await launchFacts(testLaunch, { ...quote, firstBuy, image });
    expect(facts.action).toMatchObject({
      details: {
        firstBuyMinOut: { asset: testToken, base: 80n },
        description: "A cat on the moon",
        picture: { format: "png", bytes: 2_048, width: 512, height: 512 },
      },
    });
  });

  it("show no picture for an upload whose size was never read", async () => {
    const image = { contentType: "image/png", bytes: 2_048, sha256: digest } as const;
    const facts = await launchFacts(testLaunch, { ...quote, image });
    expect(facts.action).not.toHaveProperty("details.picture");
  });

  it("name the launch wallet the launch runs from", async () => {
    const roleWallet = { role: "launch", label: "Launches" } as const;
    const facts = await launchFacts(testLaunch, quote, roleWallet);
    expect(facts.roleWallet).toStrictEqual(roleWallet);
  });
});
