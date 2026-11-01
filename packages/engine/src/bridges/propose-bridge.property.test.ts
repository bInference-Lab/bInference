import {
  type AccountRef,
  accountRefSchema,
  assetRefSchema,
  chainRefSchema,
} from "@binference/chain";
import {
  createFakeAccountCodeReader,
  createFakeAccountKindReader,
  createFakeBridge,
} from "@binference/chain/testing";
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { AddressEntryRecord } from "../agents/address-entry-record.js";
import { fixtureId } from "../contracts/store-fixtures.js";
import { bridgeQuoteDocument } from "../intents/bridge-quote.js";
import { testAgent, testNowMs, testToken } from "../intents/test-intents.js";
import { testCall } from "../operations/test-engine.js";
import { looseningWaitMs } from "../policy/send-level-change.js";
import type { BridgeRoute } from "./hosted-bridge.js";
import {
  bridgeEngine,
  testBridge,
  testDestination,
  testDestinationChain,
  testHexCodec,
  testRescueThere,
  testRoute,
} from "./test-bridges.js";

const live = { signal: new AbortController().signal };

// A family of 32-byte addresses, written as 64 hex digits, as Solana's carry 32 recipient bytes.
const wideCodec = testHexCodec("wide", 32);
const wide = chainRefSchema.parse("wide:1");
const wideArrives = assetRefSchema.parse(`wide:1/token:0x${"f3".repeat(32)}`);
const wideRoute: BridgeRoute = {
  leaves: testToken,
  arrives: wideArrives,
  decimals: { leaves: 6, arrives: 6 },
};

/** One entry of the book: on the EVM-like destination or the 32-byte one, saved in the ceiling or not. */
interface Entry {
  readonly isWide: boolean;
  readonly byte: number;
  readonly isSaved: boolean;
  readonly isBridged: boolean;
}

/** One bridge: the book, which destination it asks for, and who it names. */
interface Case {
  readonly book: readonly Entry[];
  readonly toWide: boolean;
  readonly target: { readonly kind: "entry"; readonly index: number } | { readonly kind: "rescue" };
}

function accountOf(entry: Entry): AccountRef {
  const hex = entry.byte.toString(16).padStart(2, "0");
  return entry.isWide
    ? accountRefSchema.parse(`wide:1:0x${hex.repeat(32)}`)
    : accountRefSchema.parse(`fake:2:0x000000${hex}`);
}

function recordOf(entry: Entry, index: number): AddressEntryRecord {
  const account = accountOf(entry);
  return {
    id: fixtureId("adr", index + 1),
    agentId: testAgent,
    account,
    recipientBytes: account.slice(account.lastIndexOf(":") + 1),
    label: `entry ${String(index)}`,
    usableAtMs: testNowMs - looseningWaitMs,
    ...(entry.isSaved ? { inCeilingAtMs: testNowMs - 2 * looseningWaitMs } : {}),
    createdAtMs: testNowMs - 2 * looseningWaitMs,
  };
}

const entryArbitrary: fc.Arbitrary<Entry> = fc.record({
  isWide: fc.boolean(),
  byte: fc.integer({ min: 1, max: 6 }),
  isSaved: fc.boolean(),
  isBridged: fc.boolean(),
});

const caseArbitrary: fc.Arbitrary<Case> = fc.record({
  book: fc.uniqueArray(entryArbitrary, { maxLength: 5, selector: (entry) => accountOf(entry) }),
  toWide: fc.boolean(),
  target: fc.oneof(
    fc.record({ kind: fc.constant("entry" as const), index: fc.integer({ min: 0, max: 5 }) }),
    fc.record({ kind: fc.constant("rescue" as const) }),
  ),
});

// Whom a bridge to the case's destination may pay: the entries saved there, and the rescue address
// on the destination of its own family.
function allowedOf(testCase: Case): readonly AccountRef[] {
  const saved = testCase.book.filter((entry) => entry.isSaved && entry.isWide === testCase.toWide);
  return [...saved.map(accountOf), ...(testCase.toWide ? [] : [testRescueThere])];
}

async function proposedRecipient(testCase: Case): Promise<AccountRef | undefined> {
  const records = testCase.book.map(recordOf);
  const bridged = [
    testRescueThere,
    ...testCase.book.filter((entry) => entry.isBridged).map(accountOf),
  ];
  const routes = [testRoute, wideRoute];
  const fake = createFakeBridge({ routes, quotedAtMs: testNowMs });
  const bridge = {
    ...fake,
    destinations: [...fake.destinations, { chain: wide, id: "34268394551451" }],
  };
  const codes = createFakeAccountCodeReader({ chain: testDestination });
  const kinds = createFakeAccountKindReader({ chain: wide, notWallets: [] });
  const destinations = [
    testDestinationChain(codes),
    { ref: wide, name: "Wide", assets: {}, codec: wideCodec, kinds },
  ];
  const engine = await bridgeEngine({ bridged, routes, bridge, destinations });
  await Promise.all(
    records.map(async (record) => engine.test.stores.agents.addAddress(record, live)),
  );
  const record = testCase.target.kind === "entry" ? records[testCase.target.index] : undefined;
  const to =
    testCase.target.kind === "rescue"
      ? { rescue: true as const }
      : { entry: record?.id ?? fixtureId("adr", 99) };
  const request = { ...testBridge(to), toChain: testCase.toWide ? wide : testDestination };
  const proposed = await engine.test.engine.handlers["intent/propose"](testCall(request));
  if (!proposed.ok || proposed.value.state !== "awaiting_confirmation") {
    return undefined;
  }
  const stored = await engine.test.stores.intents.get(proposed.value.intent, live);
  return bridgeQuoteDocument.decode(stored?.quote ?? null).recipient;
}

// Checks one case: the family of the destination whose card it reached, or none.
async function checkCase(testCase: Case): Promise<"evm" | "wide" | "none"> {
  const recipient = await proposedRecipient(testCase);
  expect(recipient === undefined || allowedOf(testCase).includes(recipient)).toBe(true);
  if (recipient === undefined) {
    return "none";
  }
  return testCase.toWide ? "wide" : "evm";
}

describe("a bridge's recipient", () => {
  it("is never outside the rescue address and the addresses saved for its destination", async () => {
    const carded: string[] = [];
    await fc.assert(
      fc.asyncProperty(caseArbitrary, async (testCase) => {
        carded.push(await checkCase(testCase));
      }),
      { numRuns: 80, seed: 24 },
    );
    expect(carded).toContain("evm");
    expect(carded).toContain("wide");
  });
});
