import {
  type AccountKindReader,
  type AccountRef,
  accountRefSchema,
  type AddressCodec,
  type ChainRef,
  chainRefSchema,
} from "@binference/chain";
import {
  createFakeAccountCodeReader,
  createFakeAccountKindReader,
  createFakeAddressCodec,
  createFakeVenue,
} from "@binference/chain/testing";
import { err, idSchema, ok } from "@binference/core";
import { createManualClock } from "@binference/core/testing";
import { describe, expect, it } from "vitest";
import type { AddressEntryRecord } from "../agents/address-entry-record.js";
import {
  createFakeCeilingEditor,
  type FakeCeilingEditor,
  fakeOwnerKeyCode,
} from "../fakes/fake-ceiling-editor.js";
import { testWalletRecord } from "../install/test-wallet-record.js";
import { expectOk, testAgent, testNowMs } from "../intents/test-intents.js";
import {
  startTestEngine,
  type TestEngine,
  testCall,
  testChains,
} from "../operations/test-engine.js";
import { looseningWaitMs } from "../policy/send-level-change.js";
import { sendRefusals } from "../send-levels/test-sends.js";

const live = { signal: new AbortController().signal };
const destination = chainRefSchema.parse("fake:2");
const owner: AccountRef = accountRefSchema.parse("fake:1:0x000000a1");
const program: AccountRef = accountRefSchema.parse("fake:2:0x000000d1");
const swapRouter = accountRefSchema.parse("fake:1:0x0000000b");
const wallet = testWalletRecord({
  id: idSchema("wal").parse("wal_0190f1c2-3a4b-7c5d-8e6f-0000000000c1"),
  agentId: testAgent,
  label: "main",
  createdAtMs: testNowMs - 3 * looseningWaitMs,
});

// A family of 32-byte addresses, written as 64 hex digits, as a Solana-like chain's would be.
const wideCodec: AddressCodec = {
  namespace: "wide",
  recipientLength: 32,
  parse: (text) => (/^0x[0-9a-f]{64}$/.test(text) ? ok(text) : err("malformed_address")),
  toBytes: (text) =>
    /^0x[0-9a-f]{64}$/.test(text)
      ? ok(Uint8Array.from(Buffer.from(text.slice(2), "hex")))
      : err("malformed_address"),
  fromBytes: (bytes) =>
    bytes.length === 32 ? ok(`0x${Buffer.from(bytes).toString("hex")}`) : err("malformed_address"),
};
const wide = chainRefSchema.parse("wide:1");
const kinds = createFakeAccountKindReader({ chain: destination, notWallets: [program] });
const evmLike = chainRefSchema.parse("fake:3");
const token: AccountRef = accountRefSchema.parse("fake:3:0x000000e1");
const codes = createFakeAccountCodeReader({
  chain: evmLike,
  codes: new Map([
    [token, "token"],
    [accountRefSchema.parse("fake:3:0x000000e2"), "contract"],
    [accountRefSchema.parse("fake:3:0x000000e3"), "delegation"],
  ]),
});

// The test engine with the two destinations, the rescue address in effect and the agent's wallet
// under a ceiling that reaches the fake swap; under `ceilings` when given, else the test's own.
async function engineWithDestinations(
  given: { readonly ceilings?: FakeCeilingEditor; readonly reader?: AccountKindReader } = {},
): Promise<TestEngine> {
  const destinations = [
    {
      ref: destination,
      name: "Fake Two",
      assets: {},
      codec: createFakeAddressCodec(),
      kinds: given.reader ?? kinds,
    },
    { ref: wide, name: "Wide", assets: {}, codec: wideCodec },
    { ref: evmLike, name: "Fake Three", assets: {}, codec: createFakeAddressCodec(), codes },
  ];
  const ceilingsAsked = given.ceilings === undefined ? {} : { ceilings: given.ceilings };
  const test = await startTestEngine({ destinations, ...ceilingsAsked });
  await test.stores.install.changeRescue(
    { address: owner, atMs: testNowMs - 3 * looseningWaitMs },
    live,
  );
  test.stores.install.addWallet(wallet);
  const ceilings = given.ceilings ?? test.ceilings;
  ceilings.put(wallet.policyId, [owner], { contracts: [swapRouter], perTxNativeBase: 5n });
  return test;
}

// A ceiling editor whose rewrite of calls adds a deposit function, and whose bridge rules reach
// the chains given.
function editorReaching(reach: readonly ChainRef[]): FakeCeilingEditor {
  return createFakeCeilingEditor({
    clock: createManualClock(testNowMs),
    chains: testChains(),
    venues: [createFakeVenue()],
    functionsOf: () => ["swap", "depositTo"],
    bridges: { reach },
  });
}

function add(test: TestEngine, asked: { readonly chain: string; readonly address: string }) {
  const chain = chainRefSchema.parse(asked.chain);
  const args = {
    agent: testAgent,
    chain,
    address: asked.address,
    label: "far",
    ownerKey: fakeOwnerKeyCode,
  };
  return test.engine.handlers["address/add"](testCall(args));
}

describe("saving an address on a chain a bridge delivers to", () => {
  it("lets only a bridge pay it there, never a send on the wallets' chain", async () => {
    const test = await engineWithDestinations();

    const entry = expectOk(await add(test, { chain: "fake:2", address: "0x000000F3" }));

    expect(entry.address).toBe("fake:2:0x000000f3");
    expect(test.ceilings.recipients(wallet.policyId)).toStrictEqual([owner]);
    expect(test.ceilings.bridged(wallet.policyId)).toStrictEqual([entry.address]);
    const sameAddress = accountRefSchema.parse("fake:1:0x000000f3");
    expect(await sendRefusals(test, sameAddress)).toStrictEqual(["unsaved_address"]);
    const stored = await test.stores.agents.get(testAgent, live);
    expect(stored?.addressBook.map((item) => item.recipientBytes)).toStrictEqual(["0x000000f3"]);
  });

  it("shows the room left on each such chain in the address book", async () => {
    const test = await engineWithDestinations();
    expectOk(await add(test, { chain: "fake:2", address: "0x000000f3" }));

    const listed = expectOk(
      await test.engine.handlers["address/list"](testCall({ agent: testAgent })),
    );

    expect(listed.room).toStrictEqual([{ chain: destination, used: 1, most: 100 }]);
  });

  it.each([
    {
      case: "a chain neither a wallet's nor a destination",
      chain: "fake:9",
      address: "0x000000f3",
      code: "address.unknown_chain",
    },
    {
      case: "an address of another family",
      chain: "fake:2",
      address: `0x${"ab".repeat(32)}`,
      code: "address.other_chain",
    },
    { case: "text no family reads", chain: "fake:2", address: "0x12", code: "address.malformed" },
    {
      case: "a wallet of this binference",
      chain: "fake:2",
      address: wallet.address,
      code: "address.own_wallet",
    },
    {
      case: "a program, read on chain",
      chain: "fake:2",
      address: "0x000000d1",
      code: "address.not_wallet",
    },
  ] as const)(
    "refuses $case with its reason, and saves nothing",
    async ({ chain, address, code }) => {
      const test = await engineWithDestinations();

      expect(await add(test, { chain, address })).toStrictEqual(err(code));
      const stored = await test.stores.agents.get(testAgent, live);
      expect(stored?.addressBook).toStrictEqual([]);
      expect(test.ceilings.bridged(wallet.policyId)).toStrictEqual([]);
    },
  );

  it("refuses a token's own contract on a destination it reads code on, and saves no other", async () => {
    const test = await engineWithDestinations();

    expect(await add(test, { chain: "fake:3", address: "0x000000E1" })).toStrictEqual(
      err("address.not_wallet"),
    );
    const saved = await Promise.all(
      ["0x000000E2", "0x000000E3", "0x000000E4"].map(async (address) =>
        expectOk(await add(test, { chain: "fake:3", address })),
      ),
    );
    expect(saved.map((entry) => entry.address)).toStrictEqual([
      "fake:3:0x000000e2",
      "fake:3:0x000000e3",
      "fake:3:0x000000e4",
    ]);
  });

  it("saves nothing while a destination whose code it reads does not answer", async () => {
    const test = await engineWithDestinations();
    codes.down();
    try {
      expect(await add(test, { chain: "fake:3", address: "0x000000E2" })).toStrictEqual(
        err("chain.rpc_down"),
      );
    } finally {
      codes.up();
    }
  });

  it("saves nothing while the chain it must read does not answer", async () => {
    const test = await engineWithDestinations();
    kinds.down();
    try {
      expect(await add(test, { chain: "fake:2", address: "0x000000f3" })).toStrictEqual(
        err("chain.rpc_down"),
      );
    } finally {
      kinds.up();
    }
  });

  it("refuses an address past the most one rule lists for its chain", async () => {
    const test = await engineWithDestinations();
    const fillers: readonly AddressEntryRecord[] = Array.from({ length: 100 }, (_, n) => {
      const address = `0x${(n + 1).toString(16).padStart(8, "0")}`;
      return {
        id: idSchema("adr").parse(
          `adr_0190f1c2-3a4b-7c5d-8e6f-${n.toString(16).padStart(12, "0")}`,
        ),
        agentId: testAgent,
        account: accountRefSchema.parse(`fake:2:${address}`),
        recipientBytes: address,
        label: "filler",
        usableAtMs: 0,
        inCeilingAtMs: 0,
        createdAtMs: 0,
      };
    });
    await Promise.all(fillers.map(async (entry) => test.stores.agents.addAddress(entry, live)));

    expect(await add(test, { chain: "fake:2", address: "0x000000f3" })).toStrictEqual(
      err("address.chain_full"),
    );
  });

  it("announces a save that rewrote a ceiling, and stores each wallet's copy", async () => {
    const ceilings = editorReaching([destination]);
    const test = await engineWithDestinations({ ceilings });

    const entry = expectOk(await add(test, { chain: "fake:2", address: "0x000000f3" }));

    expect(entry.noRoute).toBeUndefined();
    const journal = await test.stores.configJournal.list({ after: 0, limit: 10 }, live);
    expect(journal.map((item) => item.path)).toContain("agents.main.ceiling");
    expect(JSON.stringify(test.pushes)).toContain("notice.ceilingChange");
    const { wallets } = await test.stores.install.read(live);
    const stored = wallets.map((item) => ceilings.readStored(item.ceiling.policy));
    expect(stored).toMatchObject([{ bridged: [entry.address] }]);
  });

  it("says no route pays an address on a chain no bridge rule reaches yet", async () => {
    const test = await engineWithDestinations({ ceilings: editorReaching([]) });

    const entry = expectOk(await add(test, { chain: "fake:2", address: "0x000000f3" }));
    const listed = expectOk(
      await test.engine.handlers["address/list"](testCall({ agent: testAgent })),
    );

    expect(entry.noRoute).toBe(true);
    expect(listed.items.map((item) => item.noRoute)).toStrictEqual([true]);
  });

  it("reads every wallet's ceiling back after a rewrite custody refused part way", async () => {
    const ceilings = editorReaching([destination]);
    const refusing: FakeCeilingEditor = {
      ...ceilings,
      setCalls: async () => Promise.resolve(err("too_large" as const)),
    };
    const test = await engineWithDestinations({ ceilings: refusing });
    await test.clock.advance(60_000);

    const refused = await add(test, { chain: "fake:2", address: "0x000000f3" });

    expect(refused).toStrictEqual(err("wallet.ceiling_too_large"));
    const [stored] = (await test.stores.install.read(live)).wallets;
    expect(stored?.ceiling.readAtMs).toBe(testNowMs + 60_000);
    expect((await test.stores.agents.get(testAgent, live))?.addressBook).toStrictEqual([]);
  });

  it("saves nothing when the chain answers a read it cannot take", async () => {
    const broken: AccountKindReader = {
      chain: destination,
      read: async () => Promise.reject(new Error("an answer with no owner")),
    };
    const test = await engineWithDestinations({ reader: broken });

    expect(await add(test, { chain: "fake:2", address: "0x000000f3" })).toStrictEqual(
      err("chain.rpc_down"),
    );
  });
});
