import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { err, ok } from "@binference/core";
import type { ContractCheck } from "@binference/core/testing";
import type { PrivyId } from "../privy/privy-records.js";
import { testAddresses } from "../testing/custody-fixtures.js";
import { ownerSigner } from "../testing/owner-signer.js";
import {
  type OwnerAuthorize,
  sendSignedRecipients,
  setCeilingRecipients,
  signCeilingRecipients,
} from "../wallets/ceiling-recipients.js";
import {
  askPrivy,
  check,
  type CustodySetup,
  live,
  type PrivyCustodyHarness,
} from "./privy-custody-setup.js";

const { rescue, saved, unsaved } = testAddresses;
const sendTo = (to: string) => ({ call: { to, valueWei: 1n, data: "0x" as const } });
// A change signed for now goes out at once; the live app checks it against its own clock.
const minuteMs = 60_000;

async function policyOf(setup: CustodySetup): Promise<PrivyId> {
  const wallet = await setup.subject.api.wallet(setup.wallet.id, live());
  assert.ok(wallet.ok);
  const [policy] = wallet.value.policyIds;
  assert.ok(policy !== undefined);
  return policy;
}

// Signs as the owner, and counts the requests it signed.
function counted(authorize: OwnerAuthorize): {
  readonly authorize: OwnerAuthorize;
  readonly signed: () => number;
} {
  const tally = { signed: 0 };
  return {
    authorize: async (request, signal) => {
      tally.signed += 1;
      return authorize(request, signal);
    },
    signed: () => tally.signed,
  };
}

function inMinutes(setup: CustodySetup, minutes: number): number {
  return setup.subject.clock.now() + minutes * minuteMs;
}

async function setTo(setup: CustodySetup, recipients: readonly string[]): Promise<void> {
  const policy = await policyOf(setup);
  const options = {
    authorize: setup.subject.ownerAuthorize,
    expiresAtMs: inMinutes(setup, 5),
    ...live(),
  };
  assert.deepEqual(
    await setCeilingRecipients(setup.subject.api, { policy, recipients }, options),
    ok(undefined),
  );
}

async function paid(setup: CustodySetup, to: string): Promise<boolean> {
  return (await askPrivy(setup, sendTo(to))).ok;
}

// A shared wallet on the live app goes back to the ceiling the suite made it with.
async function restored(setup: CustodySetup): Promise<void> {
  await setTo(setup, [rescue, saved]);
}

async function movesSends(setup: CustodySetup): Promise<void> {
  await setTo(setup, [unsaved]);
  assert.deepEqual([await paid(setup, unsaved), await paid(setup, rescue)], [true, false]);
  await restored(setup);
  assert.deepEqual([await paid(setup, unsaved), await paid(setup, rescue)], [false, true]);
}

async function refusesAStranger(setup: CustodySetup): Promise<void> {
  const policy = await policyOf(setup);
  const stranger = ownerSigner(generateKeyPairSync("ec", { namedCurve: "prime256v1" }).privateKey);
  const changed = await setCeilingRecipients(
    setup.subject.api,
    { policy, recipients: [unsaved] },
    { authorize: stranger, expiresAtMs: inMinutes(setup, 5), ...live() },
  );
  assert.deepEqual(changed, err("refused"));
  assert.equal(await paid(setup, unsaved), false);
}

async function sendsWhileUnchanged(setup: CustodySetup): Promise<void> {
  const { api } = setup.subject;
  const policy = await policyOf(setup);
  const owner = counted(setup.subject.ownerAuthorize);
  const signed = await signCeilingRecipients(
    api,
    { policy, from: [rescue, saved], to: [rescue] },
    { authorize: owner.authorize, expiresAtMs: inMinutes(setup, 10), ...live() },
  );
  assert.ok(signed.ok);
  assert.equal(await paid(setup, saved), true);
  await setTo(setup, [rescue, saved, unsaved]);
  assert.deepEqual(await sendSignedRecipients(api, signed.value, live()), err("changed"));
  await restored(setup);
  assert.deepEqual(await sendSignedRecipients(api, signed.value, live()), ok(undefined));
  assert.deepEqual([await paid(setup, saved), await paid(setup, rescue)], [false, true]);
  assert.deepEqual(await sendSignedRecipients(api, signed.value, live()), ok(undefined));
  assert.equal(owner.signed(), 2);
  await restored(setup);
}

async function refusesWhenExpired(setup: CustodySetup): Promise<void> {
  const { api } = setup.subject;
  const policy = await policyOf(setup);
  const signed = await signCeilingRecipients(
    api,
    { policy, from: [rescue, saved], to: [rescue] },
    { authorize: setup.subject.ownerAuthorize, expiresAtMs: inMinutes(setup, -1), ...live() },
  );
  assert.ok(signed.ok);
  assert.deepEqual(await sendSignedRecipients(api, signed.value, live()), err("expired"));
  assert.equal(await paid(setup, saved), true);
}

/**
 * The checks of a ceiling's recipients, which only the owner key changes: at once, or signed
 * ahead and sent later while every send rule still lists what it listed when signed.
 */
export const recipientChecks = (harness: PrivyCustodyHarness): readonly ContractCheck[] => [
  check(harness, "lets the owner key move sends from one recipient to another", movesSends),
  check(harness, "refuses recipients signed by a key that is not the owner key", refusesAStranger),
  check(
    harness,
    "sends a change signed ahead only while each rule is unchanged",
    sendsWhileUnchanged,
  ),
  check(harness, "refuses a change signed ahead once its expiry has passed", refusesWhenExpired),
];
