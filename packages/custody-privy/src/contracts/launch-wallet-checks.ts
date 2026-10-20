import assert from "node:assert/strict";
import type { ContractCheck } from "@binference/core/testing";
import { brewLaunchData } from "../testing/brew-fixtures.js";
import {
  approvalForAllData,
  approveData,
  curveData,
  oneBnbWei,
  testAddresses,
} from "../testing/custody-fixtures.js";
import {
  createData,
  geniusLaunchAndBuyData,
  geniusLaunchTokenData,
  geniusUnbuiltData,
} from "../testing/launchpad-fixtures.js";
import { readBackWallet } from "../wallets/read-back.js";
import {
  askPrivy,
  check,
  type CustodySetup,
  live,
  type PrivyCustodyHarness,
  setUp,
  setUpLaunch,
  type TestCall,
} from "./privy-custody-setup.js";

const { curve, token, rescue, unsaved, unlisted, router } = testAddresses;
const refused = { ok: false, error: "refused" };

// The suite's wallet and its launch wallet, made on first use.
async function both(
  harness: PrivyCustodyHarness,
): Promise<{ readonly main: CustodySetup; readonly launch: CustodySetup }> {
  const subject = harness.create();
  return { main: await setUp(subject), launch: await setUpLaunch(subject) };
}

function launchCheck(
  harness: PrivyCustodyHarness,
  name: string,
  run: (wallets: { readonly main: CustodySetup; readonly launch: CustodySetup }) => Promise<void>,
): ContractCheck {
  return { name, run: async () => run(await both(harness)) };
}

async function privySigns(setup: CustodySetup, call: TestCall): Promise<void> {
  const answer = await askPrivy(setup, { call });
  assert.ok(answer.ok, `Privy refused a launch wallet's call to ${call.to}.`);
}

async function privyRefuses(setup: CustodySetup, call: TestCall): Promise<void> {
  assert.deepEqual(await askPrivy(setup, { call }), refused);
}

// A curve's `buy` with the coin, or its `sell`, paying the account given.
function curveCall(side: "buy" | "sell", recipient: string): TestCall {
  return { to: curve, valueWei: side === "buy" ? oneBnbWei : 0n, data: curveData(side, recipient) };
}

// What a launch wallet may approve: any spender through `approve` alone, within each capped token's
// cap, and a token no cap names in any amount.
function approvalChecks(harness: PrivyCustodyHarness): readonly ContractCheck[] {
  return [
    launchCheck(harness, "refuses an approval through any function but approve", async (w) => {
      await privyRefuses(w.launch, { to: token, valueWei: 0n, data: approvalForAllData(curve) });
      await privyRefuses(w.launch, { to: token, valueWei: 1n, data: approveData(curve, 7n) });
    }),
    launchCheck(harness, "signs an approval of a token no cap names, of any size", async (w) => {
      await privySigns(w.launch, {
        to: unlisted,
        valueWei: 0n,
        data: approveData(curve, 10n ** 30n),
      });
    }),
    // The loss bound of decision 0217 rests on this: any spender, a thief's too, within the cap.
    launchCheck(
      harness,
      "signs an approval naming any spender of a capped token, in its cap",
      async (w) => {
        await privySigns(w.launch, { to: token, valueWei: 0n, data: approveData(unsaved, 5n) });
      },
    ),
    launchCheck(harness, "refuses an approval of a capped token above its cap", async (w) => {
      await privyRefuses(w.launch, { to: token, valueWei: 0n, data: approveData(curve, 1_001n) });
    }),
  ];
}

// Genius.fun's create calls (decision 0277): its two built ones, signed from the launch wallet and
// refused from the main wallet, and an overload it never builds, refused from the launch wallet too.
function geniusChecks(harness: PrivyCustodyHarness): readonly ContractCheck[] {
  const launchAndBuy = (recipient: string): TestCall => ({
    to: router,
    valueWei: oneBnbWei,
    data: geniusLaunchAndBuyData({ quoteIn: oneBnbWei - 2_000_000_000_000_000n, recipient }),
  });
  const launchToken: TestCall = {
    to: router,
    valueWei: 2_000_000_000_000_000n,
    data: geniusLaunchTokenData(),
  };
  return [
    launchCheck(
      harness,
      "signs Genius.fun's launchAndBuy and launchToken from the launch wallet",
      async (w) => {
        await privySigns(w.launch, launchAndBuy(w.launch.wallet.address));
        await privySigns(w.launch, launchToken);
      },
    ),
    launchCheck(
      harness,
      "refuses Genius.fun's launchAndBuy and launchToken from the main wallet",
      async (w) => {
        await privyRefuses(w.main, launchAndBuy(w.main.wallet.address));
        await privyRefuses(w.main, launchToken);
      },
    ),
    launchCheck(
      harness,
      "refuses a Genius.fun create overload the venue never builds, even from the launch wallet",
      async (w) => {
        const recipient = w.launch.wallet.address;
        const quoteIn = oneBnbWei - 2_000_000_000_000_000n;
        await privyRefuses(w.launch, {
          to: router,
          valueWei: oneBnbWei,
          data: geniusUnbuiltData({ quoteIn, recipient }),
        });
      },
    ),
  ];
}

// Brew's `launch` with a 1 BNB first buy for `recipient`, paying no launch fee.
const brewLaunch = (recipient: string): TestCall => ({
  to: router,
  valueWei: oneBnbWei,
  data: brewLaunchData({ buyWei: oneBnbWei, recipient }),
});

// Brew's create call (decision 0283): signed from the launch wallet, refused from the main wallet.
function brewChecks(harness: PrivyCustodyHarness): readonly ContractCheck[] {
  return [
    launchCheck(harness, "signs Brew's launch from the launch wallet", async (w) => {
      await privySigns(w.launch, brewLaunch(w.launch.wallet.address));
    }),
    launchCheck(harness, "refuses Brew's launch from the main wallet", async (w) => {
      await privyRefuses(w.main, brewLaunch(w.main.wallet.address));
    }),
  ];
}

/**
 * What a launch wallet's ceiling holds on the Privy fake and the Privy test app (decision 0217):
 * a curve's `buy` and `sell` on a contract no list holds, paying the launch wallet itself, and an
 * approval naming the curve, which the agent's main wallet is refused; Flap's, Genius.fun's and
 * Brew's create calls, refused from the main wallet, and a Genius.fun overload the venue never builds,
 * refused from the launch wallet too (decision 0277); an approval naming any
 * spender of a capped token within its cap, which is what a stolen key can take; a call paying
 * anyone else, a send to an unsaved address and an approval through any other function, refused.
 */
export function launchWalletChecks(harness: PrivyCustodyHarness): readonly ContractCheck[] {
  return [
    check(harness, "makes a launch wallet whose ceiling reads back as asked", async (setup) => {
      const launch = await setUpLaunch(setup.subject);
      const found = await readBackWallet(
        setup.subject.api,
        { wallet: launch.wallet.id, expected: launch.expected },
        live(),
      );
      assert.deepEqual(found, { ok: true, value: launch.wallet });
    }),
    launchCheck(harness, "signs a curve's buy and sell paying the launch wallet", async (w) => {
      await privySigns(w.launch, curveCall("buy", w.launch.wallet.address));
      await privySigns(w.launch, curveCall("sell", w.launch.wallet.address));
      await privySigns(w.launch, { to: token, valueWei: 0n, data: approveData(curve, 7n) });
    }),
    launchCheck(harness, "signs a launchpad's create call from the launch wallet", async (w) => {
      await privySigns(w.launch, { to: router, valueWei: oneBnbWei, data: createData(oneBnbWei) });
    }),
    launchCheck(harness, "refuses the create call from the main wallet", async (w) => {
      await privyRefuses(w.main, { to: router, valueWei: oneBnbWei, data: createData(oneBnbWei) });
    }),
    launchCheck(harness, "refuses the same buy and sell from the main wallet", async (w) => {
      await privyRefuses(w.main, curveCall("buy", w.main.wallet.address));
      await privyRefuses(w.main, curveCall("sell", w.main.wallet.address));
      await privyRefuses(w.main, { to: token, valueWei: 0n, data: approveData(curve, 7n) });
    }),
    launchCheck(harness, "refuses a curve call paying anyone but the launch wallet", async (w) => {
      await privyRefuses(w.launch, curveCall("buy", w.main.wallet.address));
      await privyRefuses(w.launch, curveCall("sell", unsaved));
      await privyRefuses(w.launch, curveCall("buy", rescue));
    }),
    launchCheck(harness, "refuses a launch wallet's send to an unsaved address", async (w) => {
      await privyRefuses(w.launch, { to: unsaved, valueWei: 1n, data: "0x" });
      await privyRefuses(w.launch, { to: w.main.wallet.address, valueWei: 1n, data: "0x" });
    }),
    ...geniusChecks(harness),
    ...brewChecks(harness),
    ...approvalChecks(harness),
    launchCheck(harness, "refuses a curve call above the cap in native coin", async (w) => {
      const buy = curveCall("buy", w.launch.wallet.address);
      await privyRefuses(w.launch, { ...buy, valueWei: oneBnbWei + 1n });
    }),
  ];
}
