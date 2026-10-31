import assert from "node:assert/strict";
import { idSchema } from "@binference/core";
import type { ContractCheck } from "@binference/core/testing";
import { buildCeiling } from "../ceiling/build-ceiling.js";
import type { Ceiling, ChainCaps } from "../ceiling/ceiling.js";
import {
  approveTo,
  callData,
  type DepositArgs,
  depositData,
  depositV3Data,
  registerData,
} from "../testing/bridge-fixtures.js";
import {
  bridgeAddresses,
  stakingAddresses,
  testStakingCeilingRequest,
  testTargets,
} from "../testing/bridge-target-fixtures.js";
import { oneBnbWei, testAddresses } from "../testing/custody-fixtures.js";
import { setCeilingCalls } from "../wallets/ceiling-calls.js";
import {
  askPrivy,
  type CustodySetup,
  heldCapsOf,
  live,
  type PrivyCustodyHarness,
  policyOf,
  setUp,
  type TestCall,
  walletUnder,
} from "./privy-custody-setup.js";

const { spokePool, bscUsdc, bscEth, baseUsdc, robinhoodWeth, ethereumUsdc } = bridgeAddresses;
const { baseSaved, robinhoodSaved, rescue, identity } = bridgeAddresses;
const { stakeHub, stakeManager, slisBnb, depository } = stakingAddresses;
const { unsaved } = testAddresses;
const validator: Hex = "0x85e99B4093C337A9d5EF478bE8E95d2632a638DD";
const secondBase: Hex = "0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359";
const refused = { ok: false, error: "refused" };

type Hex = `0x${string}`;

// A wallet's address as the calldata helpers take it; Privy answers checksummed hex.
function hexOf(address: string): Hex {
  assert.ok(/^0x[0-9a-fA-F]{40}$/.test(address), "Privy answered no EVM address.");
  return `0x${address.slice(2)}`;
}

interface Wallets {
  readonly main: CustodySetup;
  readonly bridge: CustodySetup;
}

const made = new WeakMap<object, Promise<Wallets>>();

function ceilingOf(wallet: "main" | "bridge"): (caps: ChainCaps) => Ceiling {
  return (caps) => {
    const built = buildCeiling(testStakingCeilingRequest(caps, wallet));
    assert.ok(built.ok);
    return built.value;
  };
}

const id = (n: string) => idSchema("wal").parse(`wal_0190f1c2-3b4c-7d5e-8f60-71829300000${n}`);

// A wallet that bridges, stakes and registers, and a bridge wallet, beside the suite's wallet and
// under its 24-hour caps, so the suite makes no more aggregations.
async function makeWallets(harness: PrivyCustodyHarness): Promise<Wallets> {
  const subject = harness.create();
  const caps = heldCapsOf(await setUp(subject));
  const main = await walletUnder(subject, { ceiling: ceilingOf("main"), caps, id: id("1") });
  const bridge = await walletUnder(subject, { ceiling: ceilingOf("bridge"), caps, id: id("2") });
  return { main, bridge };
}

function bridgeCheck(
  harness: PrivyCustodyHarness,
  name: string,
  run: (wallets: Wallets) => Promise<void>,
): ContractCheck {
  return {
    name,
    run: async () => {
      const subject = harness.create();
      const wallets = made.get(subject) ?? makeWallets(harness);
      made.set(subject, wallets);
      await run(await wallets);
    },
  };
}

async function signs(setup: CustodySetup, call: TestCall): Promise<boolean> {
  return (await askPrivy(setup, { call })).ok;
}

async function privySigns(setup: CustodySetup, call: TestCall): Promise<void> {
  assert.ok(await signs(setup, call), `Privy refused a call inside the ceiling to ${call.to}.`);
}

async function privyRefuses(setup: CustodySetup, call: TestCall): Promise<void> {
  assert.deepEqual(await askPrivy(setup, { call }), refused);
}

function depositCall(setup: CustodySetup, args: Partial<DepositArgs>, valueWei = 0n): TestCall {
  const data = depositV3Data({
    depositor: hexOf(setup.wallet.address),
    recipient: baseSaved,
    inputToken: bscUsdc,
    outputToken: baseUsdc,
    destinationChainId: 8453n,
    ...args,
  });
  return { to: spokePool, valueWei, data };
}

const call = (to: string, data: Hex, valueWei = 0n): TestCall => ({ to, valueWei, data });

// The Base lane's recipients written with the owner key, then asked again every half second for up
// to 15 seconds, until a deposit to `probe` signs or not as expected.
async function baseRecipientsBecome(
  setup: CustodySetup,
  change: { readonly recipients: readonly string[]; readonly probe: Hex; readonly signs: boolean },
): Promise<boolean> {
  const caps = heldCapsOf(setup);
  const request = testStakingCeilingRequest(caps);
  const chains = request.chains.map((chain) =>
    Object.assign({}, chain, {
      bridges: testTargets.map((target) =>
        target.destinationChainId === "8453"
          ? Object.assign({}, target, { recipients: change.recipients })
          : target,
      ),
    }),
  );
  const written = await setCeilingCalls(
    setup.subject.api,
    { policy: await policyOf(setup), chains },
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

function acceptChecks(harness: PrivyCustodyHarness): readonly ContractCheck[] {
  return [
    bridgeCheck(harness, "signs a deposit to an address saved for each chain", async ({ main }) => {
      await privySigns(main, depositCall(main, {}));
      const robinhood = { recipient: robinhoodSaved, inputToken: bscEth };
      await privySigns(
        main,
        depositCall(main, { ...robinhood, outputToken: robinhoodWeth, destinationChainId: 4663n }),
      );
      await privySigns(
        main,
        depositCall(main, { recipient: rescue, outputToken: ethereumUsdc, destinationChainId: 1n }),
      );
      await privySigns(main, call(bscUsdc, approveTo(spokePool, 5n)));
    }),
    bridgeCheck(harness, "signs staking that credits the wallet itself", async ({ main }) => {
      await privySigns(main, call(stakeHub, callData.delegate(validator), oneBnbWei));
      await privySigns(main, call(stakeHub, callData.undelegate(validator)));
      await privySigns(main, call(stakeHub, callData.claim(validator)));
      await privySigns(main, call(stakeManager, callData.deposit(), oneBnbWei));
      await privySigns(main, call(slisBnb, approveTo(stakeManager, 5n)));
      await privySigns(main, call(stakeManager, callData.requestWithdraw()));
      await privySigns(main, call(stakeManager, callData.claimWithdraw()));
    }),
    bridgeCheck(harness, "signs an identity registration", async ({ main }) => {
      await privySigns(main, call(identity, registerData.uri));
    }),
    bridgeCheck(harness, "signs a Relay deposit from the bridge wallet alone", async (w) => {
      const deposit = callData.depositErc20(hexOf(w.bridge.wallet.address), bscUsdc);
      await privySigns(w.bridge, call(depository, deposit));
      await privySigns(w.bridge, call(bscUsdc, approveTo(depository, 5n)));
      await privyRefuses(
        w.main,
        call(depository, callData.depositErc20(hexOf(w.main.wallet.address), bscUsdc)),
      );
      await privyRefuses(w.main, call(bscUsdc, approveTo(depository, 5n)));
    }),
  ];
}

function refuseChecks(harness: PrivyCustodyHarness): readonly ContractCheck[] {
  return [
    bridgeCheck(harness, "refuses a deposit to an unsaved address or another chain", async (w) => {
      await privyRefuses(w.main, depositCall(w.main, { recipient: unsaved }));
      await privyRefuses(w.main, depositCall(w.main, { destinationChainId: 1n }));
      await privyRefuses(w.main, depositCall(w.main, { destinationChainId: 10n }));
      await privyRefuses(w.main, depositCall(w.main, { destinationChainId: 137n }));
    }),
    bridgeCheck(harness, "refuses a deposit that refunds another or carries coin", async (w) => {
      await privyRefuses(w.main, depositCall(w.main, { depositor: unsaved }));
      await privyRefuses(w.main, depositCall(w.main, {}, 1n));
      await privyRefuses(w.main, depositCall(w.main, { outputToken: robinhoodWeth }));
    }),
    bridgeCheck(harness, "refuses the 32-byte deposit, which no ceiling lists", async (w) => {
      const args = { depositor: hexOf(w.main.wallet.address), recipient: baseSaved };
      const data = depositData({
        ...args,
        inputToken: bscUsdc,
        outputToken: baseUsdc,
        destinationChainId: 8453n,
      });
      await privyRefuses(w.main, call(spokePool, data));
    }),
    bridgeCheck(harness, "refuses staking past the cap or crediting another", async ({ main }) => {
      await privyRefuses(main, call(stakeHub, callData.delegate(validator), 2n * oneBnbWei));
      await privyRefuses(main, call(stakeHub, callData.redelegate(validator, unsaved)));
      await privyRefuses(main, call(stakeManager, callData.claimWithdrawFor(unsaved)));
    }),
    bridgeCheck(harness, "refuses moving the identity token", async ({ main }) => {
      const from = hexOf(main.wallet.address);
      await privyRefuses(main, call(identity, callData.transferFrom(from, unsaved)));
      await privyRefuses(main, call(identity, callData.setApprovalForAll(unsaved)));
    }),
  ];
}

function changeChecks(harness: PrivyCustodyHarness): readonly ContractCheck[] {
  return [
    bridgeCheck(
      harness,
      "pays a Base address once the owner saves it, and no more after",
      async (w) => {
        const added = [baseSaved, secondBase];
        assert.ok(
          await baseRecipientsBecome(w.main, { recipients: added, probe: secondBase, signs: true }),
        );
        assert.ok(
          await baseRecipientsBecome(w.main, {
            recipients: [baseSaved],
            probe: secondBase,
            signs: false,
          }),
        );
      },
    ),
  ];
}

/**
 * The bridge, staking and identity rules on Privy (decisions 0302 to 0304): deposits to addresses
 * saved for each chain and staking that credits the wallet signed, every deposit to another
 * address or chain refused, Relay's deposits signed from a bridge wallet alone, and a saved address
 * added and taken out with the owner key within 15 seconds.
 */
export function bridgeStakingChecks(harness: PrivyCustodyHarness): readonly ContractCheck[] {
  return [...acceptChecks(harness), ...refuseChecks(harness), ...changeChecks(harness)];
}
