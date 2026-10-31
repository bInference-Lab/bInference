import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { type CustodySetup, policyOf, setUp } from "../contracts/privy-custody-setup.js";
import type { PrivyId } from "../privy/privy-records.js";
import { createFakeCustodySubject, type FakeCustodySubject } from "./fake-custody-subject.js";
import { createLeftoverRemovals, type LeftoverRemovals } from "./leftover-removals.js";
import { ownerSigner } from "./owner-signer.js";

const live = () => ({ signal: AbortSignal.timeout(5_000) });

interface Scene {
  readonly subject: FakeCustodySubject;
  readonly setup: CustodySetup;
  readonly removals: LeftoverRemovals;
  readonly owner: () => Parameters<LeftoverRemovals["deletePolicy"]>[1];
}

async function scene(): Promise<Scene> {
  const subject = createFakeCustodySubject(3);
  const { privy, clock } = subject;
  const removals = createLeftoverRemovals({
    http: privy.http,
    clock,
    appId: privy.appId,
    appSecret: privy.appSecret,
  });
  const owner = () => ({ authorize: subject.ownerAuthorize, ...live() });
  return { subject, setup: await setUp(subject), removals, owner };
}

async function ownerQuorumOf({ subject, setup }: Scene): Promise<PrivyId> {
  const wallet = await subject.api.wallet(setup.wallet.id, live());
  const ownerId = wallet.ok ? wallet.value.ownerId : null;
  expect(ownerId).not.toBeNull();
  return ownerId ?? ("" as PrivyId);
}

describe("createLeftoverRemovals", () => {
  it("keeps a policy a wallet still holds and deletes it once the wallet lets it go", async () => {
    const found = await scene();
    const { subject, setup, removals, owner } = found;
    const policy = await policyOf(setup);

    await expect(removals.deletePolicy(policy, owner())).resolves.toBe("kept");
    await expect(removals.detachPolicies(setup.wallet.id, owner())).resolves.toBe("removed");
    const wallet = await subject.api.wallet(setup.wallet.id, live());
    expect(wallet).toMatchObject({ ok: true, value: { policyIds: [], signers: [] } });
    await expect(removals.deletePolicy(policy, owner())).resolves.toBe("removed");
    await expect(removals.deletePolicy(policy, owner())).resolves.toBe("gone");
  });

  it("keeps a key quorum that owns a wallet and deletes one that owns nothing", async () => {
    const found = await scene();
    const { subject, removals, owner } = found;
    const empty = await subject.api.createKeyQuorum(
      { publicKey: subject.ownerKey, displayName: "binference test owner" },
      live(),
    );

    await expect(removals.deleteKeyQuorum(await ownerQuorumOf(found), owner())).resolves.toBe(
      "kept",
    );
    await expect(removals.deleteKeyQuorum(empty.id, owner())).resolves.toBe("removed");
    await expect(removals.deleteKeyQuorum(empty.id, owner())).resolves.toBe("gone");
  });

  it("keeps what another key signs to remove", async () => {
    const { setup, removals } = await scene();
    const stranger = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
    const call = { authorize: ownerSigner(stranger.privateKey), ...live() };

    await expect(removals.detachPolicies(setup.wallet.id, call)).resolves.toBe("kept");
    await expect(removals.deletePolicy(await policyOf(setup), call)).resolves.toBe("kept");
  });
});
