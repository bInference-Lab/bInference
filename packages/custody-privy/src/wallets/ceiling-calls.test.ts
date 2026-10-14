import { err, ok } from "@binference/core";
import { describe, expect, it } from "vitest";
import type { CeilingChain } from "../ceiling/ceiling.js";
import { readCeiling } from "../ceiling/read-ceiling.js";
import { setUp } from "../contracts/privy-custody-setup.js";
import { isPrivyId, type PrivyId } from "../privy/privy-records.js";
import {
  oneBnbWei,
  testAddresses,
  testCalls,
  testChain,
  testLaunch,
} from "../testing/custody-fixtures.js";
import {
  createFakeCustodySubject,
  type FakeCustodySubject,
} from "../testing/fake-custody-subject.js";
import { setCeilingCalls } from "./ceiling-calls.js";
import type { OwnerAuthorize } from "./rule-plans.js";

const live = { signal: new AbortController().signal };
const { router } = testAddresses;
const unknownPolicy = "unknownpolicy00000000000" as PrivyId;
const refusing: OwnerAuthorize = async () => Promise.resolve(err("refused"));
const swapOnly = testCalls.filter((item) => item.abi.name === "swap");

function namesSwapTo(rules: readonly string[]): boolean {
  return rules.some((rule) => rule.includes("swapTo"));
}

interface Made {
  readonly subject: FakeCustodySubject;
  readonly policy: PrivyId;
  /** The ceiling's chain with its own caps, the cap and the calls given. */
  readonly chainWith: (calls: CeilingChain["calls"], cap: bigint) => CeilingChain;
}

// The test wallet's ceiling on the fake Privy, owned by the subject's owner key.
async function made(): Promise<Made> {
  const subject = createFakeCustodySubject();
  const setup = await setUp(subject);
  const wallet = await subject.api.wallet(setup.wallet.id, live);
  const policy = wallet.ok ? wallet.value.policyIds[0] : undefined;
  if (policy === undefined || !isPrivyId(policy)) {
    throw new Error("Expected the wallet's policy.");
  }
  const held = await heldOf(subject, policy);
  const [caps] = held?.caps ?? [];
  if (caps === undefined) {
    throw new Error("Expected the ceiling's caps.");
  }
  return {
    subject,
    policy,
    chainWith: (calls, cap) => ({
      chain: testChain,
      calls,
      spenders: [router],
      perTxNativeCapBase: cap,
      caps: caps.caps,
    }),
  };
}

async function heldOf(subject: FakeCustodySubject, policy: PrivyId) {
  const held = await subject.api.policy(policy, live);
  return held.ok ? readCeiling(held.value.rules) : undefined;
}

async function namesOf(subject: FakeCustodySubject, policy: PrivyId) {
  const held = await subject.api.policy(policy, live);
  return held.ok ? held.value.rules.map((rule) => JSON.stringify(rule)) : [];
}

function call(subject: FakeCustodySubject, authorize: OwnerAuthorize = subject.ownerAuthorize) {
  return { authorize, expiresAtMs: subject.clock.now() + 60_000, ...live };
}

describe("the contract calls of a ceiling", () => {
  it("list the given calls and cap once the owner key signs, and twice alike", async () => {
    const { subject, policy, chainWith } = await made();
    const twoBnb = chainWith(testCalls, 2n * oneBnbWei);

    expect(
      await setCeilingCalls(subject.api, { policy, chains: [twoBnb] }, call(subject)),
    ).toStrictEqual(ok(undefined));
    expect(
      await setCeilingCalls(subject.api, { policy, chains: [twoBnb] }, call(subject)),
    ).toStrictEqual(ok(undefined));

    expect(await heldOf(subject, policy)).toMatchObject({
      contracts: [router],
      perTxNativeCapBase: 2n * oneBnbWei,
    });
  });

  it("takes out the rule of a function no venue calls any more, and adds it back", async () => {
    const { subject, policy, chainWith } = await made();
    const swap = chainWith(swapOnly, oneBnbWei);

    await setCeilingCalls(subject.api, { policy, chains: [swap] }, call(subject));
    expect(namesSwapTo(await namesOf(subject, policy))).toBe(false);

    const both = chainWith(testCalls, oneBnbWei);
    await setCeilingCalls(subject.api, { policy, chains: [both] }, call(subject));
    expect(namesSwapTo(await namesOf(subject, policy))).toBe(true);
  });

  it("add a launch wallet's launch rules with its calls, and take them out of any other", async () => {
    const { subject, policy, chainWith } = await made();
    const launch = { ...chainWith(testCalls, oneBnbWei), launch: testLaunch };

    await setCeilingCalls(subject.api, { policy, chains: [launch] }, call(subject));
    expect(await heldOf(subject, policy)).toMatchObject({ isLaunch: true });
    await setCeilingCalls(subject.api, { policy, chains: [launch] }, call(subject));
    const named = await namesOf(subject, policy);
    expect(named.filter((rule) => rule.includes('"name":"Launch '))).toHaveLength(3);

    await setCeilingCalls(
      subject.api,
      { policy, chains: [chainWith(testCalls, oneBnbWei)] },
      call(subject),
    );
    expect(await heldOf(subject, policy)).toMatchObject({ isLaunch: false });
  });

  it("change nothing for another key, an unknown policy or a chain it does not enable", async () => {
    const { subject, policy, chainWith } = await made();
    const before = await namesOf(subject, policy);
    const target = { policy, chains: [chainWith([], 2n * oneBnbWei)] };
    const otherChain = { ...chainWith([], oneBnbWei), chain: { ...testChain, chainId: 97 } };

    expect(await setCeilingCalls(subject.api, target, call(subject, refusing))).toStrictEqual(
      err("refused"),
    );
    expect(
      await setCeilingCalls(subject.api, { ...target, policy: unknownPolicy }, call(subject)),
    ).toStrictEqual(err("not_found"));
    expect(
      await setCeilingCalls(subject.api, { policy, chains: [otherChain] }, call(subject)),
    ).toStrictEqual(err("not_found"));
    expect(await namesOf(subject, policy)).toStrictEqual(before);
  });
});
