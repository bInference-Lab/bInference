import { err, ok } from "@binference/core";
import { describe, expect, it } from "vitest";
import { readCeiling } from "../ceiling/read-ceiling.js";
import { setUp } from "../contracts/privy-custody-setup.js";
import { isPrivyId, type PrivyId } from "../privy/privy-records.js";
import { oneBnbWei, testAddresses, testChain } from "../testing/custody-fixtures.js";
import {
  createFakeCustodySubject,
  type FakeCustodySubject,
} from "../testing/fake-custody-subject.js";
import { setCeilingCalls } from "./ceiling-calls.js";
import type { OwnerAuthorize } from "./rule-plans.js";

const live = { signal: new AbortController().signal };
const { router, permit2 } = testAddresses;
const unknownPolicy = "unknownpolicy00000000000" as PrivyId;
const refusing: OwnerAuthorize = async () => Promise.resolve(err("refused"));

// The test wallet's ceiling on the fake Privy, owned by the subject's owner key.
async function made(): Promise<{ readonly subject: FakeCustodySubject; readonly policy: PrivyId }> {
  const subject = createFakeCustodySubject();
  const setup = await setUp(subject);
  const wallet = await subject.api.wallet(setup.wallet.id, live);
  const policy = wallet.ok ? wallet.value.policyIds[0] : undefined;
  if (policy === undefined || !isPrivyId(policy)) {
    throw new Error("Expected the wallet's policy.");
  }
  return { subject, policy };
}

async function heldOf(subject: FakeCustodySubject, policy: PrivyId) {
  const held = await subject.api.policy(policy, live);
  return held.ok ? readCeiling(held.value.rules) : undefined;
}

function call(subject: FakeCustodySubject, authorize: OwnerAuthorize = subject.ownerAuthorize) {
  return { authorize, expiresAtMs: subject.clock.now() + 60_000, ...live };
}

const twoBnb = {
  chain: testChain,
  contracts: [router],
  spenders: [router],
  perTxNativeCapBase: 2n * oneBnbWei,
};

describe("the contract calls of a ceiling", () => {
  it("list the given contracts and cap once the owner key signs, and twice alike", async () => {
    const { subject, policy } = await made();

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

  it("change nothing for another key, an unknown policy or a rule the policy lacks", async () => {
    const { subject, policy } = await made();
    const before = await heldOf(subject, policy);
    const target = { policy, chains: [twoBnb] };
    const otherChain = { ...twoBnb, chain: { ...testChain, chainId: 97 } };

    expect(await setCeilingCalls(subject.api, target, call(subject, refusing))).toStrictEqual(
      err("refused"),
    );
    expect(
      await setCeilingCalls(subject.api, { ...target, policy: unknownPolicy }, call(subject)),
    ).toStrictEqual(err("not_found"));
    expect(
      await setCeilingCalls(subject.api, { policy, chains: [otherChain] }, call(subject)),
    ).toStrictEqual(err("not_found"));
    expect(await heldOf(subject, policy)).toStrictEqual(before);
    expect(before?.contracts).toContain(permit2);
  });
});
