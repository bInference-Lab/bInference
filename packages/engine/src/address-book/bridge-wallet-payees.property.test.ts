import { type AccountRef, accountRefSchema, chainRefSchema } from "@binference/chain";
import { idSchema } from "@binference/core";
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { fakeOwnerKeyCode } from "../fakes/fake-ceiling-editor.js";
import { testWalletRecord } from "../install/test-wallet-record.js";
import { testAgent, testNowMs } from "../intents/test-intents.js";
import { startTestEngine, type TestEngine, testCall } from "../operations/test-engine.js";
import { looseningWaitMs } from "../policy/send-level-change.js";
import { saveTestAddress, testSaved } from "../send-levels/test-sends.js";

const live = { signal: new AbortController().signal };
const chain = chainRefSchema.parse("fake:1");
const owner: AccountRef = accountRefSchema.parse("fake:1:0x000000a1");
const main = testWalletRecord({
  id: idSchema("wal").parse("wal_0190f1c2-3a4b-7c5d-8e6f-0000000000c1"),
  agentId: testAgent,
  label: "main",
  createdAtMs: testNowMs - 3 * looseningWaitMs,
});
// The agent's bridge wallet, which the owner funds from outside only (decision 0307).
const bridge = testWalletRecord({
  id: idSchema("wal").parse("wal_0190f1c2-3a4b-7c5d-8e6f-0000000000c4"),
  agentId: testAgent,
  label: "bridge",
  createdAtMs: testNowMs - 2 * looseningWaitMs,
  role: "bridge",
});

// The bridge wallet's address as an owner may type it, and two other addresses.
const typed = ["0x000000c4", "0x000000C4", "0x000000f3", "0x000000f5"] as const;

type Step =
  | { readonly kind: "add"; readonly address: string }
  | { readonly kind: "rescue"; readonly address: string }
  | { readonly kind: "create" };

const step: fc.Arbitrary<Step> = fc.oneof(
  fc.record({ kind: fc.constant("add" as const), address: fc.constantFrom(...typed) }),
  fc.record({ kind: fc.constant("rescue" as const), address: fc.constantFrom(...typed) }),
  fc.record({ kind: fc.constant("create" as const) }),
);

async function engineWith(restored: readonly string[]): Promise<TestEngine> {
  const custodyWallets = new Map(
    [main, bridge].map((wallet) => [wallet.id, accountRefSchema.parse(`fake:1:${wallet.address}`)]),
  );
  const test = await startTestEngine({ custodyWallets });
  await test.stores.install.changeRescue(
    { address: owner, atMs: testNowMs - 3 * looseningWaitMs },
    live,
  );
  for (const wallet of [main, bridge]) {
    test.stores.install.addWallet(wallet);
    test.ceilings.put(wallet.policyId, [owner]);
  }
  // A book restored from a backup may hold any address, the bridge wallet's among them.
  for (const [index, address] of restored.entries()) {
    const id = idSchema("adr").parse(`adr_0190f1c2-3a4b-7c5d-8e6f-00000000010${String(index)}`);
    const account = accountRefSchema.parse(`${chain}:${address}`);
    // oxlint-disable-next-line eslint/no-await-in-loop -- the book keeps its order
    await saveTestAddress(test, { ...testSaved, id, account });
  }
  return test;
}

async function run(test: TestEngine, taken: Step): Promise<void> {
  const ownerKey = fakeOwnerKeyCode;
  const { handlers } = test.engine;
  if (taken.kind === "create") {
    await handlers["wallet/create"](testCall({ agent: testAgent, label: "spare", ownerKey }));
    return;
  }
  const address = accountRefSchema.parse(`${chain}:${taken.address}`);
  await (taken.kind === "add"
    ? handlers["address/add"](
        testCall({ agent: testAgent, chain, address: taken.address, label: "x", ownerKey }),
      )
    : handlers["safety/setRescueAddress"](testCall({ address, ownerKey })));
}

// Every account each live wallet's ceiling lets a send pay, in lowercase.
async function payees(test: TestEngine): Promise<readonly string[]> {
  const { wallets } = await test.stores.install.read(live);
  return wallets.flatMap((wallet) =>
    (test.ceilings.recipients(wallet.policyId) ?? []).map((account) => account.toLowerCase()),
  );
}

describe("the bridge wallet as a payee", () => {
  it("is never an account any wallet's ceiling lets a send pay", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.subarray([...typed]),
        fc.array(step, { maxLength: 4 }),
        async (restored: readonly string[], steps: readonly Step[]) => {
          const test = await engineWith(restored);
          for (const taken of steps) {
            // oxlint-disable-next-line eslint/no-await-in-loop -- the owner's steps run in order
            await run(test, taken);
          }
          await test.clock.advance(looseningWaitMs);
          await test.engine.settle(live);

          expect(await payees(test)).not.toContain(`fake:1:${bridge.address}`);
        },
      ),
      { numRuns: 40 },
    );
  });
});
