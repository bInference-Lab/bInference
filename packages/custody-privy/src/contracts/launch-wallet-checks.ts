import assert from "node:assert/strict";
import type { ContractCheck } from "@binference/core/testing";
import {
  approvalForAllData,
  approveData,
  curveData,
  oneBnbWei,
  testAddresses,
} from "../testing/custody-fixtures.js";
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

const { curve, token, rescue, unsaved } = testAddresses;
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

/**
 * What a launch wallet's ceiling holds on the Privy fake and the Privy test app (decision 0217):
 * a curve's `buy` and `sell` on a contract no list holds, paying the launch wallet itself, and an
 * approval naming the curve, which the agent's main wallet is refused; a call paying anyone else,
 * a send to an unsaved address and an approval through any other function, refused.
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
    launchCheck(harness, "refuses an approval through any function but approve", async (w) => {
      await privyRefuses(w.launch, { to: token, valueWei: 0n, data: approvalForAllData(curve) });
      await privyRefuses(w.launch, { to: token, valueWei: 1n, data: approveData(curve, 7n) });
    }),
    launchCheck(harness, "refuses a curve call above the cap in native coin", async (w) => {
      const buy = curveCall("buy", w.launch.wallet.address);
      await privyRefuses(w.launch, { ...buy, valueWei: oneBnbWei + 1n });
    }),
  ];
}
