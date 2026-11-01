import { type AccountRef, accountRefSchema } from "@binference/chain";
import type { Result } from "@binference/core";
import type { ProtocolErrorCode } from "@binference/protocol";
import { type BridgeTest, testRescue, testSpoke } from "../bridges/test-bridges.js";
import { fakeOwnerKeyCode } from "../fakes/fake-ceiling-editor.js";
import { testCall, testCallers } from "../operations/test-engine.js";

const live = { signal: new AbortController().signal };

/** A new rescue address the owner may set, on the fake chain. */
export const nextRescue: AccountRef = accountRefSchema.parse("fake:1:0x000000d8");

// The policy of the bench's test wallet, its first.
async function testPolicyOf(bench: BridgeTest): Promise<string> {
  const { wallets } = await bench.test.stores.install.read(live);
  const [wallet] = wallets;
  if (wallet === undefined) {
    throw new Error("The bridge bench holds no wallet.");
  }
  return wallet.policyId;
}

/**
 * The test wallet's ceiling as the fake custody holds it, enabling the fake chain alone, paying
 * the rescue address in effect there and calling the fake bridge's spoke, and its policy id. Its
 * next write lists the entry saved for the destination in its bridge rules.
 */
export async function holdTestCeiling(bench: BridgeTest): Promise<string> {
  const policy = await testPolicyOf(bench);
  bench.test.ceilings.put(policy, [testRescue], { contracts: [testSpoke], perTxNativeBase: 1n });
  return policy;
}

/** Asks the engine, from the CLI with the owner key, for a new rescue address. */
export async function setTestRescue(
  bench: BridgeTest,
  address: AccountRef,
): Promise<Result<{ readonly effectiveAt: number }, ProtocolErrorCode>> {
  return bench.test.engine.handlers["safety/setRescueAddress"](
    testCall({ address, ownerKey: fakeOwnerKeyCode }, testCallers.cli),
  );
}
