import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { err } from "@binference/core";
import type { ContractCheck } from "@binference/core/testing";
import type { PrivyId } from "../privy/privy-records.js";
import { swapData, testAddresses } from "../testing/custody-fixtures.js";
import { ownerSigner } from "../testing/owner-signer.js";
import type { OwnerAuthorize } from "../wallets/rule-plans.js";
import { removeSigner, swapSigner } from "../wallets/signer-moves.js";
import {
  askPrivy,
  check,
  type CustodySetup,
  live,
  type PrivyCustodyHarness,
} from "./privy-custody-setup.js";

// A call inside the ceiling: Privy signs it for the wallet's signer and for nobody else.
const inside = { to: testAddresses.router, valueWei: 0n, data: swapData(5n) };
const refused = err("refused");
const minuteMs = 60_000;

/** The wallet's ceiling and its one signer, as Privy holds them. */
interface Held {
  readonly policy: PrivyId;
  readonly signer: PrivyId;
}

async function heldOf(setup: CustodySetup): Promise<Held> {
  const wallet = await setup.subject.api.wallet(setup.wallet.id, live());
  assert.ok(wallet.ok);
  const [policy] = wallet.value.policyIds;
  const [signer] = wallet.value.signers;
  assert.ok(policy !== undefined && signer !== undefined);
  return { policy, signer: signer.signerId };
}

function signed(setup: CustodySetup, authorize: OwnerAuthorize = setup.subject.ownerAuthorize) {
  return { authorize, expiry: () => setup.subject.clock.now() + 5 * minuteMs, ...live() };
}

// The stranger's key as a key quorum of its own, as an attached machine's agent key would be.
async function strangerQuorum(setup: CustodySetup): Promise<PrivyId> {
  const { api, strangerProcess } = setup.subject;
  const publicKey = await strangerProcess.publicKey(live());
  return (await api.createKeyQuorum({ publicKey, displayName: "binference agent key" }, live())).id;
}

// The live app keeps one wallet for the whole suite: its first signer comes back at the end.
async function swapBack(setup: CustodySetup, held: Held): Promise<void> {
  const wallets = [{ wallet: setup.wallet.id, policy: held.policy }];
  const back = await swapSigner(setup.subject.api, { wallets, signer: held.signer }, signed(setup));
  assert.ok(back.ok);
}

async function swapsAndRefusesTheOld(setup: CustodySetup): Promise<void> {
  const held = await heldOf(setup);
  const signer = await strangerQuorum(setup);
  const wallets = [{ wallet: setup.wallet.id, policy: held.policy }];
  const swapped = await swapSigner(setup.subject.api, { wallets, signer }, signed(setup));
  assert.deepEqual(swapped, { ok: true, value: [held.signer] });
  const asNew = { call: inside, signerProcess: setup.subject.strangerProcess };
  assert.ok((await askPrivy(setup, asNew)).ok);
  assert.deepEqual(await askPrivy(setup, { call: inside }), refused);
  await swapBack(setup, held);
  assert.ok((await askPrivy(setup, { call: inside })).ok);
}

async function keepsTheSignerForAnotherKey(setup: CustodySetup): Promise<void> {
  const held = await heldOf(setup);
  const signer = await strangerQuorum(setup);
  const other = ownerSigner(generateKeyPairSync("ec", { namedCurve: "prime256v1" }).privateKey);
  const wallets = [{ wallet: setup.wallet.id, policy: held.policy }];
  const swapped = await swapSigner(setup.subject.api, { wallets, signer }, signed(setup, other));
  assert.deepEqual(swapped, refused);
  assert.deepEqual(await heldOf(setup), held);
  assert.ok((await askPrivy(setup, { call: inside })).ok);
}

async function removesButNeverTheLast(setup: CustodySetup): Promise<void> {
  const { api, strangerProcess } = setup.subject;
  const held = await heldOf(setup);
  const signer = await strangerQuorum(setup);
  const both = [held.signer, signer].map((id) => ({ signer: id, policies: [held.policy] }));
  const options = signed(setup);
  const change = { wallet: setup.wallet.id, signers: both, expiresAtMs: options.expiry() };
  assert.ok((await api.setSigners(change, options)).ok);
  const wallets = [setup.wallet.id];
  const removed = await removeSigner(api, { wallets, signer }, signed(setup));
  assert.deepEqual(removed, { ok: true, value: wallets });
  assert.deepEqual(
    await askPrivy(setup, { call: inside, signerProcess: strangerProcess }),
    refused,
  );
  const last = await removeSigner(api, { wallets, signer: held.signer }, signed(setup));
  assert.deepEqual(last, err("last_signer"));
  const gone = await removeSigner(api, { wallets, signer }, signed(setup));
  assert.deepEqual(gone, err("not_signer"));
  assert.deepEqual(await heldOf(setup), held);
}

/**
 * Checks that the owner key alone moves a wallet's signer, that Privy refuses the key it removed
 * and signs for the key it added, and that the last signer never leaves.
 */
export const signerChecks = (harness: PrivyCustodyHarness): readonly ContractCheck[] => [
  check(
    harness,
    "signs for the agent key that replaced the wallet's signer and refuses the old one",
    swapsAndRefusesTheOld,
  ),
  check(
    harness,
    "keeps the wallet's signer when a key other than the owner key signs the change",
    keepsTheSignerForAnotherKey,
  ),
  check(
    harness,
    "removes a second signer, keeps the first, and never removes the last",
    removesButNeverTheLast,
  ),
];
