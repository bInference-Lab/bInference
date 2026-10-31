import assert from "node:assert/strict";
import { idSchema } from "@binference/core";
import type { ContractCheck } from "@binference/core/testing";
import { buildCeiling } from "../ceiling/build-ceiling.js";
import type { Ceiling, ChainCaps } from "../ceiling/ceiling.js";
import { policyRuleJson } from "../ceiling/policy-rule.js";
import { readCeiling } from "../ceiling/read-ceiling.js";
import { callData } from "../testing/bridge-fixtures.js";
import {
  stakingAddresses,
  testBridgeWalletCeilingRequest,
} from "../testing/bridge-target-fixtures.js";
import {
  approveData,
  oneBnbWei,
  swapData,
  testAddresses,
  transferData,
} from "../testing/custody-fixtures.js";
import { readBackWallet } from "../wallets/read-back.js";
import { hexOf, privyRefuses, privySigns } from "./bridge-staking-checks.js";
import {
  type CustodySetup,
  heldCapsOf,
  live,
  type PrivyCustodyHarness,
  type PrivyCustodySubject,
  setUp,
  type TestCall,
  walletUnder,
} from "./privy-custody-setup.js";
import { sharedWalletsCheck } from "./shared-wallets-check.js";

const { depository } = stakingAddresses;
const { router, token, rescue, unsaved } = testAddresses;

/** The suite's wallet, a main wallet, and a bridge wallet beside it under the same caps. */
interface Wallets {
  readonly main: CustodySetup;
  readonly bridge: CustodySetup;
}

function bridgeCeiling(caps: ChainCaps): Ceiling {
  const built = buildCeiling(testBridgeWalletCeilingRequest(caps));
  assert.ok(built.ok);
  return built.value;
}

const bridgeWallet = idSchema("wal").parse("wal_0190f1c2-3b4c-7d5e-8f60-718293000010");
const made = new WeakMap<PrivyCustodySubject, Promise<Wallets>>();

// The bridge wallet beside the suite's wallet, under its 24-hour caps, so the suite makes no more
// aggregations.
async function makeWallets(subject: PrivyCustodySubject): Promise<Wallets> {
  const main = await setUp(subject);
  const caps = heldCapsOf(main);
  const bridge = await walletUnder(subject, { ceiling: bridgeCeiling, caps, id: bridgeWallet });
  return { main, bridge };
}

function bridgeWalletCheck(
  harness: PrivyCustodyHarness,
  name: string,
  run: (wallets: Wallets) => Promise<void>,
): ContractCheck {
  return sharedWalletsCheck(harness, { made, make: makeWallets }, { name, run });
}

// Relay's token deposit of the test token, paying back the depositor given.
const tokenDeposit = (depositor: `0x${string}`): TestCall => ({
  to: depository,
  valueWei: 0n,
  data: callData.depositErc20(depositor, `0x${token.slice(2)}`),
});

// Relay's coin deposit of the value given, paying back the depositor given.
const coinDeposit = (depositor: `0x${string}`, valueWei = oneBnbWei): TestCall => ({
  to: depository,
  valueWei,
  data: callData.depositNative(depositor),
});

function signChecks(harness: PrivyCustodyHarness): readonly ContractCheck[] {
  return [
    bridgeWalletCheck(
      harness,
      "makes a bridge wallet that holds only Relay's deposits",
      async (w) => {
        const found = await readBackWallet(
          w.bridge.subject.api,
          { wallet: w.bridge.wallet.id, expected: w.bridge.expected },
          live(),
        );
        assert.deepEqual(found, { ok: true, value: w.bridge.wallet });
        const held = readCeiling(w.bridge.expected.ceiling.rules.map(policyRuleJson));
        assert.deepEqual([held?.contracts, held?.isLaunch], [[depository], false]);
      },
    ),
    bridgeWalletCheck(harness, "signs a Relay deposit from the bridge wallet", async (w) => {
      await privySigns(w.bridge, tokenDeposit(hexOf(w.bridge.wallet.address)));
      await privySigns(w.bridge, coinDeposit(hexOf(w.bridge.wallet.address)));
      await privySigns(w.bridge, { to: token, valueWei: 0n, data: approveData(depository, 5n) });
    }),
    bridgeWalletCheck(
      harness,
      "signs the bridge wallet's sends to the rescue address",
      async (w) => {
        await privySigns(w.bridge, { to: rescue, valueWei: 1n, data: "0x" });
        await privySigns(w.bridge, { to: token, valueWei: 0n, data: transferData(rescue, 5n) });
      },
    ),
  ];
}

function refuseChecks(harness: PrivyCustodyHarness): readonly ContractCheck[] {
  return [
    bridgeWalletCheck(harness, "refuses a Relay deposit from the main wallet", async (w) => {
      await privyRefuses(w.main, tokenDeposit(hexOf(w.main.wallet.address)));
      await privyRefuses(w.main, coinDeposit(hexOf(w.main.wallet.address)));
      await privyRefuses(w.main, { to: token, valueWei: 0n, data: approveData(depository, 5n) });
    }),
    bridgeWalletCheck(
      harness,
      "refuses a send from the main wallet to the bridge wallet",
      async (w) => {
        const address = w.bridge.wallet.address;
        await privyRefuses(w.main, { to: address, valueWei: 1n, data: "0x" });
        await privyRefuses(w.main, { to: token, valueWei: 0n, data: transferData(address, 5n) });
      },
    ),
    bridgeWalletCheck(harness, "refuses the bridge wallet any main wallet's call", async (w) => {
      await privyRefuses(w.bridge, { to: router, valueWei: 0n, data: swapData(5n) });
      await privyRefuses(w.bridge, { to: token, valueWei: 0n, data: approveData(router, 5n) });
    }),
    bridgeWalletCheck(
      harness,
      "refuses a Relay deposit refunding another or past the cap",
      async (w) => {
        await privyRefuses(w.bridge, tokenDeposit(`0x${unsaved.slice(2)}`));
        await privyRefuses(w.bridge, coinDeposit(hexOf(w.bridge.wallet.address), oneBnbWei + 1n));
        await privyRefuses(w.bridge, { to: unsaved, valueWei: 1n, data: "0x" });
      },
    ),
  ];
}

/**
 * What a bridge wallet's ceiling holds on the Privy fake and the Privy test app (decision 0307):
 * Relay's deposits paying back the bridge wallet and an approval naming the depository, and its
 * sends to the rescue address, which a rescue takes; the same deposits and approval refused from
 * the main wallet, a send from the main wallet to the bridge wallet refused, and from the bridge
 * wallet every main wallet's call, a deposit refunding another, one past the cap per call and a
 * send to an unsaved address refused.
 */
export function bridgeWalletChecks(harness: PrivyCustodyHarness): readonly ContractCheck[] {
  return [...signChecks(harness), ...refuseChecks(harness)];
}
