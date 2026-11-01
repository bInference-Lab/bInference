import { type AccountRef, accountRefSchema, chainRefSchema } from "@binference/chain";
import {
  err,
  type Id,
  idSchema,
  type JsonValue,
  jsonValueSchema,
  type Result,
} from "@binference/core";
import { createManualClock } from "@binference/core/testing";
import type { ProtocolErrorCode, ResultOf } from "@binference/protocol";
import { z } from "zod";
import type { AddressEntryRecord } from "../agents/address-entry-record.js";
import {
  type BridgeTest,
  bridgeFakes,
  bridgeLimits,
  testDestination,
  testFarEntry,
  testRescue,
  testSpoke,
} from "../bridges/test-bridges.js";
import {
  createFakeCeilingEditor,
  type FakeCeilingEditor,
  fakeOwnerKeyCode,
} from "../fakes/fake-ceiling-editor.js";
import type { CeilingEditor } from "../install/ports.js";
import { testWalletRecord } from "../install/test-wallet-record.js";
import { testAgent, testAgentDraft, testNowMs, testWallet } from "../intents/test-intents.js";
import { testCall, testCallers } from "../operations/test-engine.js";

const live = { signal: new AbortController().signal };

/** A new rescue address the owner may set, on the fake chain. */
export const nextRescue: AccountRef = accountRefSchema.parse("fake:1:0x000000d8");
/** The new rescue address on the destination. */
export const nextRescueThere: AccountRef = accountRefSchema.parse("fake:2:0x000000d8");
/** A second agent of the install, with a wallet and an address saved for the destination. */
export const altAgent: Id<"agt"> = idSchema("agt").parse(
  "agt_0190f1c2-3a4b-7c5d-8e6f-00000000000a",
);

// What a ceiling the tests hold allows a contract call: the fake bridge's spoke.
const spokeCalls = { contracts: [testSpoke], perTxNativeBase: 1n };

/** The policy of the bench's test wallet, its first. */
export async function testPolicyOf(bench: BridgeTest): Promise<string> {
  const { wallets } = await bench.test.stores.install.read(live);
  const [wallet] = wallets;
  if (wallet === undefined) {
    throw new Error("The bridge bench holds no wallet.");
  }
  return wallet.policyId;
}

/**
 * Custody that writes only the first ceiling of each change of calls and then refuses the rest,
 * and the fake that holds what it wrote.
 */
export function partWayCustody(): {
  readonly held: FakeCeilingEditor;
  readonly partWay: CeilingEditor;
} {
  const held = createFakeCeilingEditor({
    clock: createManualClock(testNowMs),
    chains: bridgeFakes().chains,
  });
  const partWay: CeilingEditor = {
    ...held,
    setCalls: async (request, call) => {
      await held.setCalls({ ...request, ceilings: request.ceilings.slice(0, 1) }, call);
      return err("too_large");
    },
  };
  return { held, partWay };
}

/**
 * The test wallet's ceiling as the fake custody holds it, enabling the fake chain alone, paying
 * the rescue address in effect there and calling the fake bridge's spoke, and its policy id. Its
 * next write lists the entry saved for the destination in its bridge rules.
 */
export async function holdTestCeiling(bench: BridgeTest): Promise<string> {
  const policy = await testPolicyOf(bench);
  bench.test.ceilings.put(policy, [testRescue], spokeCalls);
  return policy;
}

/**
 * Adds the second agent, live under the bridge limits, with a wallet whose ceiling the fake custody
 * holds as the test wallet's, and an address saved for the destination; answers the ceiling.
 */
export async function addAltAgent(bench: BridgeTest): Promise<string> {
  const { test } = bench;
  const draft = testAgentDraft({ id: altAgent, name: "alt", mode: "live", limits: bridgeLimits });
  await test.stores.agents.create(draft, live);
  const wallet = testWalletRecord({
    id: idSchema("wal").parse("wal_0190f1c2-3a4b-7c5d-8e6f-0000000000a7"),
    agentId: altAgent,
    label: "alt",
    createdAtMs: testNowMs - 1,
  });
  test.stores.install.addWallet(wallet);
  test.ceilings.put(wallet.policyId, [testRescue], spokeCalls);
  const entry: AddressEntryRecord = {
    ...testFarEntry,
    id: idSchema("adr").parse("adr_0190f1c2-3a4b-7c5d-8e6f-0000000000a8"),
    agentId: altAgent,
    account: accountRefSchema.parse("fake:2:0x000000b2"),
    recipientBytes: "0x000000b2",
  };
  await test.stores.agents.addAddress(entry, live);
  return wallet.policyId;
}

/** Asks the engine, from the CLI with the owner key or the code given, for a new rescue address. */
export async function setTestRescue(
  bench: BridgeTest,
  address: AccountRef,
  ownerKey: string = fakeOwnerKeyCode,
): Promise<Result<{ readonly effectiveAt: number }, ProtocolErrorCode>> {
  return bench.test.engine.handlers["safety/setRescueAddress"](
    testCall({ address, ownerKey }, testCallers.cli),
  );
}

/** Saves an address for an agent with the owner key: on the destination, by default. */
export async function saveFor(
  bench: BridgeTest,
  saving: { readonly address: string; readonly agent?: Id<"agt">; readonly chain?: string },
): Promise<Result<ResultOf<"address/add">, ProtocolErrorCode>> {
  const args = {
    agent: saving.agent ?? testAgent,
    chain: saving.chain === undefined ? testDestination : chainRefSchema.parse(saving.chain),
    address: saving.address,
    label: "far",
    ownerKey: fakeOwnerKeyCode,
  };
  return bench.test.engine.handlers["address/add"](testCall(args));
}

/** Changes the test wallet's agent's per-transaction cap with the owner key, a change of calls. */
export async function setTestCap(
  bench: BridgeTest,
  perTxNative: bigint,
): Promise<Result<ResultOf<"ceiling/set">, ProtocolErrorCode>> {
  const args = { wallet: testWallet, changes: { perTxNative }, ownerKey: fakeOwnerKeyCode };
  return bench.test.engine.handlers["ceiling/set"](testCall(args));
}

// What every notice push carries: its message key and its values.
const noticeSchema = z.looseObject({ key: z.string(), values: jsonValueSchema });

/** The values of the notices the engine pushed under `key`, in order. */
export function noticesNamed(bench: BridgeTest, key: string): readonly JsonValue[] {
  return bench.test.pushes.flatMap((push) => {
    const notice = push.topic === "notice" ? noticeSchema.safeParse(push.data) : undefined;
    return notice?.success === true && notice.data.key === key ? [notice.data.values] : [];
  });
}
