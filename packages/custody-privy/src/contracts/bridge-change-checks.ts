import assert from "node:assert/strict";
import { ok } from "@binference/core";
import type { ContractCheck } from "@binference/core/testing";
import type { ChainAddresses } from "../ceiling/ceiling.js";
import { readRuleRefs } from "../privy/privy-wire.schema.js";
import {
  bridgeAddresses,
  testBridged,
  testStakingCeilingRequest,
} from "../testing/bridge-target-fixtures.js";
import { onTestChain, testAddresses } from "../testing/custody-fixtures.js";
import { setCeilingRecipients } from "../wallets/ceiling-recipients.js";
import { sendSignedRecipients, signCeilingRecipients } from "../wallets/signed-recipients.js";
import {
  bridgeCheck,
  depositCall,
  type Hex,
  privyRefuses,
  privySigns,
  signs,
  type Wallets,
} from "./bridge-staking-checks.js";
import { live, type PrivyCustodyHarness, policyOf } from "./privy-custody-setup.js";

const { baseSaved, rescue, ethereumUsdc } = bridgeAddresses;
const { unsaved } = testAddresses;
const secondBase: Hex = "0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359";

// The addresses named per destination, those for Base replaced by the ones given.
function base(addresses: readonly string[]): readonly ChainAddresses[] {
  return testBridged.map((item) => (item.chainId === "8453" ? { ...item, addresses } : item));
}

// The ceiling's recipients written with the owner key, a second Base address saved for Base or
// not, then asked again every half second for up to 15 seconds, until a deposit to `probe` signs or
// not as expected.
async function baseRecipientsBecome(
  wallets: Wallets,
  change: { readonly saved: readonly string[]; readonly probe: Hex; readonly signs: boolean },
): Promise<boolean> {
  const setup = wallets.main;
  const request = testStakingCeilingRequest(wallets.caps, {
    kind: "main",
    routeCaps: wallets.routeCaps,
  });
  const written = await setCeilingRecipients(
    setup.subject.api,
    {
      policy: await policyOf(setup),
      recipients: [
        ...onTestChain(request.rescue, baseSaved),
        ...base([baseSaved, ...change.saved]),
      ],
      bridged: base([baseSaved, secondBase]),
    },
    {
      ...live(),
      authorize: setup.subject.ownerAuthorize,
      expiresAtMs: setup.subject.clock.now() + 60_000,
    },
  );
  assert.ok(written.ok);
  const probe = depositCall(setup, { recipient: change.probe });
  for (let tries = 0; tries < 30; tries += 1) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- the live app may answer before every request sees the change
    if ((await signs(setup, probe)) === change.signs) {
      return true;
    }
    // oxlint-disable-next-line eslint/no-await-in-loop -- half a second between asks
    await setup.subject.clock.sleep(500, live().signal);
  }
  return false;
}

// The main wallet's recipients written now with the owner key: the rescue addresses given on the
// test chain beside the saved one, and on Base the addresses given, which its bridge rules pay.
async function writeRescues(
  wallets: Wallets,
  listed: { readonly here: readonly string[]; readonly base: readonly string[] },
): Promise<void> {
  const setup = wallets.main;
  const written = await setCeilingRecipients(
    setup.subject.api,
    {
      policy: await policyOf(setup),
      recipients: [...onTestChain(...listed.here, baseSaved), ...base(listed.base)],
      bridged: base(listed.base),
    },
    {
      ...live(),
      authorize: setup.subject.ownerAuthorize,
      expiresAtMs: setup.subject.clock.now() + 60_000,
    },
  );
  assert.ok(written.ok);
}

// Asks every half second for up to 15 seconds whether Privy signs a USDC deposit to `recipient` on
// Base from the main wallet, until it answers as expected.
async function baseDepositSigns(
  wallets: Wallets,
  probe: { readonly recipient: Hex; readonly signs: boolean },
): Promise<boolean> {
  const setup = wallets.main;
  const call = depositCall(setup, { recipient: probe.recipient });
  for (let tries = 0; tries < 30; tries += 1) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- the live app may answer before every request sees the change
    if ((await signs(setup, call)) === probe.signs) {
      return true;
    }
    // oxlint-disable-next-line eslint/no-await-in-loop -- half a second between asks
    await setup.subject.clock.sleep(500, live().signal);
  }
  return false;
}

/**
 * The rescue address in Base's bridge rule (decision 0321): paid there beside the saved address
 * once a change of recipients lists it there, and a replaced one kept until the change signed for
 * its time is sent, never earlier. Each leaves the main wallet as the first check of
 * {@link bridgeChangeChecks} found it.
 */
function rescueChecks(harness: PrivyCustodyHarness): readonly ContractCheck[] {
  const rescueOnBase: Hex = rescue;
  const settled = { here: [rescue], base: [baseSaved] };
  return [
    bridgeCheck(harness, "pays the rescue address on Base beside a saved address", async (w) => {
      await writeRescues(w, { here: [rescue], base: [baseSaved, rescue] });
      assert.ok(await baseDepositSigns(w, { recipient: rescueOnBase, signs: true }));
      assert.ok(await baseDepositSigns(w, { recipient: baseSaved, signs: true }));
      await writeRescues(w, settled);
      assert.ok(await baseDepositSigns(w, { recipient: rescueOnBase, signs: false }));
    }),
    bridgeCheck(
      harness,
      "keeps a replaced rescue address paid on Base until the change signed for it is sent",
      async (w) => {
        const { api } = w.main.subject;
        const policy = await policyOf(w.main);
        await writeRescues(w, { here: [rescue, unsaved], base: [baseSaved, rescue, unsaved] });
        const from = [
          ...onTestChain(rescue, unsaved, baseSaved),
          ...base([baseSaved, rescue, unsaved]),
        ];
        const to = [...onTestChain(unsaved, baseSaved), ...base([baseSaved, unsaved])];
        const expiresAtMs = w.main.subject.clock.now() + 60_000;
        const options = { ...live(), authorize: w.main.subject.ownerAuthorize, expiresAtMs };
        const signed = await signCeilingRecipients(api, { policy, from, to }, options);
        assert.ok(signed.ok);
        assert.ok(await baseDepositSigns(w, { recipient: rescueOnBase, signs: true }));
        assert.deepEqual(await sendSignedRecipients(api, signed.value, live()), ok(undefined));
        assert.ok(await baseDepositSigns(w, { recipient: rescueOnBase, signs: false }));
        assert.ok(await baseDepositSigns(w, { recipient: unsaved, signs: true }));
        await writeRescues(w, settled);
      },
    ),
  ];
}

/**
 * The bridge rules changed with the owner key on Privy (decision 0302): a Base address saved and
 * taken out within 15 seconds, a replaced rescue address taken out of every destination by a
 * change signed ahead, and the rescue address in Base's rule (decision 0321).
 */
export function bridgeChangeChecks(harness: PrivyCustodyHarness): readonly ContractCheck[] {
  return [
    bridgeCheck(
      harness,
      "pays a Base address once the owner saves it, and no more once it is removed",
      async (w) => {
        assert.ok(
          await baseRecipientsBecome(w, { saved: [secondBase], probe: secondBase, signs: true }),
        );
        assert.ok(await baseRecipientsBecome(w, { saved: [], probe: secondBase, signs: false }));
        assert.ok(await baseRecipientsBecome(w, { saved: [], probe: baseSaved, signs: true }));
      },
    ),
    bridgeCheck(
      harness,
      "takes a replaced rescue address out of every destination in a change signed ahead",
      async ({ bridge }) => {
        const { api } = bridge.subject;
        const policy = await policyOf(bridge);
        const destinations = testBridged.filter((item) => item.chainId !== "1");
        const from = [...onTestChain(rescue, baseSaved), ...testBridged];
        const to = [...onTestChain(unsaved, baseSaved), ...destinations];
        const expiresAtMs = bridge.subject.clock.now() + 60_000;
        const options = { ...live(), authorize: bridge.subject.ownerAuthorize, expiresAtMs };
        const signed = await signCeilingRecipients(api, { policy, from, to }, options);
        assert.ok(signed.ok);
        assert.equal(signed.value.removes?.length, 2);
        assert.deepEqual(await sendSignedRecipients(api, signed.value, live()), ok(undefined));
        const toRescue = { recipient: rescue, outputToken: ethereumUsdc, destinationChainId: 1n };
        await privyRefuses(bridge, depositCall(bridge, toRescue));
        await privySigns(bridge, depositCall(bridge, {}));
        const after = await api.policy(policy, live());
        const names = after.ok
          ? (readRuleRefs(after.value.rules) ?? []).map((ref) => ref.name)
          : [];
        assert.ok(
          !names.some((name) => name.includes(" to 1, ")),
          "An Ethereum bridge rule stayed.",
        );
      },
    ),
    ...rescueChecks(harness),
  ];
}
