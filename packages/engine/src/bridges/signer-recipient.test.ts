import {
  type AccountRef,
  accountRefSchema,
  assetRefSchema,
  type Bridge,
  type ChainRef,
  chainRefSchema,
} from "@binference/chain";
import {
  createFakeAccountCodeReader,
  createFakeBridge,
  fakeDepositAbi,
} from "@binference/chain/testing";
import { describe, expect, it } from "vitest";
import type { AddressEntryRecord } from "../agents/address-entry-record.js";
import { fixtureId } from "../contracts/store-fixtures.js";
import { expectOk, testAgent, testNowMs, testToken } from "../intents/test-intents.js";
import { testCall } from "../operations/test-engine.js";
import { looseningWaitMs } from "../policy/send-level-change.js";
import type { BridgeRoute } from "./hosted-bridge.js";
import {
  bridgeEngine,
  testBridge,
  testDestination,
  testDestinationChain,
  testHexCodec,
} from "./test-bridges.js";

const live = { signal: new AbortController().signal };
const narrow = chainRefSchema.parse("narrow:1");
const wide = chainRefSchema.parse("wide:1");

function routeTo(chain: ChainRef, bytes: number): BridgeRoute {
  const arrives = assetRefSchema.parse(`${chain}/token:0x${"f3".repeat(bytes)}`);
  return { leaves: testToken, arrives, decimals: { leaves: 6, arrives: 6 } };
}

function entryOn(chain: ChainRef, bytes: number, n: number): AddressEntryRecord {
  const address = `0x${"a1".repeat(bytes)}`;
  return {
    id: fixtureId("adr", n),
    agentId: testAgent,
    account: accountRefSchema.parse(`${chain}:${address}`),
    recipientBytes: address,
    label: `entry ${String(n)}`,
    usableAtMs: testNowMs - looseningWaitMs,
    inCeilingAtMs: testNowMs - 2 * looseningWaitMs,
    createdAtMs: testNowMs - 2 * looseningWaitMs,
  };
}

const narrowEntry = entryOn(narrow, 20, 1);
const wideEntry = entryOn(wide, 32, 2);

// The fake bridge declaring its deposit's recipient input, as Across declares `depositV3`, so the
// signer binds the recipient, and delivering to a 20-byte and a 32-byte destination.
function declaringBridge(routes: readonly BridgeRoute[]): Bridge {
  const fake = createFakeBridge({ routes, quotedAtMs: testNowMs });
  const bound = {
    recipient: "id",
    destinationChain: "amount",
    tokenIn: "token",
    tokenOut: "token",
    minOut: "amount",
    emptyInputs: [],
  };
  const call = {
    contract: "spoke",
    abi: fakeDepositAbi,
    walletInputs: ["depositor"],
    bridge: bound,
  };
  return {
    ...fake,
    destinations: [...fake.destinations, { chain: narrow, id: "10" }, { chain: wide, id: "11" }],
    contracts: fake.contracts.map((entry) => Object.assign({}, entry, { calls: [call] })),
  };
}

async function proposedTo(entry: AddressEntryRecord, toChain: ChainRef) {
  const routes = [routeTo(narrow, 20), routeTo(wide, 32)];
  const bridged: readonly AccountRef[] = [narrowEntry.account, wideEntry.account];
  const destinations = [
    testDestinationChain(createFakeAccountCodeReader({ chain: testDestination })),
    { ref: narrow, name: "Narrow", assets: {}, codec: testHexCodec("narrow", 20) },
    { ref: wide, name: "Wide", assets: {}, codec: testHexCodec("wide", 32) },
  ];
  const bridge = declaringBridge(routes);
  const { test } = await bridgeEngine({ bridged, routes, bridge, destinations });
  await Promise.all(
    [narrowEntry, wideEntry].map(async (record) => test.stores.agents.addAddress(record, live)),
  );
  const request = { ...testBridge({ entry: entry.id }), toChain };
  return expectOk(await test.engine.handlers["intent/propose"](testCall(request)));
}

describe("a bridge whose venue declares its deposit's recipient", () => {
  it("opens a card for a 20-byte recipient, which the signer binds", async () => {
    const view = await proposedTo(narrowEntry, narrow);
    expect(view.state).toBe("awaiting_confirmation");
  });

  it("ends a 32-byte recipient before its card, since the signer could bind it to nothing", async () => {
    const view = await proposedTo(wideEntry, wide);
    expect([view.state, view.outcome?.reason]).toStrictEqual(["failed_check", "decode_mismatch"]);
  });
});
