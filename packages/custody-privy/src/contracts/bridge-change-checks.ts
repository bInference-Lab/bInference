import assert from "node:assert/strict";
import { ok } from "@binference/core";
import type { ContractCheck } from "@binference/core/testing";
import { readRuleRefs } from "../privy/privy-wire.schema.js";
import {
  bridgeAddresses,
  testBridged,
  testStakingCeilingRequest,
} from "../testing/bridge-target-fixtures.js";
import { testAddresses } from "../testing/custody-fixtures.js";
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

const { baseSaved, robinhoodSaved, rescue, ethereumUsdc } = bridgeAddresses;
const { unsaved } = testAddresses;
const secondBase: Hex = "0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359";

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
  const bridged = testBridged.map((item) =>
    item.chainId === "8453" ? { chainId: item.chainId, addresses: [baseSaved, secondBase] } : item,
  );
  const written = await setCeilingRecipients(
    setup.subject.api,
    {
      policy: await policyOf(setup),
      recipients: [request.rescue, ...request.saved, ...change.saved],
      bridged,
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

/**
 * The bridge rules changed with the owner key on Privy (decision 0302): a Base address saved and
 * taken out within 15 seconds, and a replaced rescue address taken out of every destination by a
 * change signed ahead.
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
        const from = [rescue, baseSaved, robinhoodSaved];
        const to = [unsaved, baseSaved, robinhoodSaved];
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
  ];
}
