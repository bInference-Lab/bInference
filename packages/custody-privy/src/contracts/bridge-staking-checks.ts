import assert from "node:assert/strict";
import { idSchema } from "@binference/core";
import type { ContractCheck } from "@binference/core/testing";
import { buildCeiling } from "../ceiling/build-ceiling.js";
import type { Ceiling, ChainCaps } from "../ceiling/ceiling.js";
import { aggregationsOf, type ChainCapPlan } from "../ceiling/day-caps.js";
import {
  approveTo,
  callData,
  type DepositArgs,
  depositData,
  depositToData,
  depositV3Data,
  registerData,
} from "../testing/bridge-fixtures.js";
import {
  bridgeAddresses,
  solanaBridgeId,
  stakingAddresses,
  testStakingCeilingRequest,
} from "../testing/bridge-target-fixtures.js";
import { oneBnbWei, testAddresses, testChain } from "../testing/custody-fixtures.js";
import {
  askPrivy,
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

const { spokePool, bscUsdc, bscEth, baseUsdc, robinhoodWeth, ethereumUsdc } = bridgeAddresses;
const { baseSaved, robinhoodSaved, rescue, identity } = bridgeAddresses;
const { solanaSaved, solanaUnsaved, solanaUsdc } = bridgeAddresses;
const { stakeHub, stakeManager, slisBnb, depository } = stakingAddresses;
const { unsaved } = testAddresses;
const validator: Hex = "0x85e99B4093C337A9d5EF478bE8E95d2632a638DD";
const refused = { ok: false, error: "refused" };

/** A 0x-prefixed hex string. */
export type Hex = `0x${string}`;

/** A wallet's address as the calldata helpers take it; Privy answers checksummed hex. */
export function hexOf(address: string): Hex {
  assert.ok(/^0x[0-9a-fA-F]{40}$/.test(address), "Privy answered no EVM address.");
  return `0x${address.slice(2)}`;
}

/** The bridge checks' wallets: one that bridges, stakes and registers, and a bridge wallet. */
export interface Wallets {
  readonly main: CustodySetup;
  readonly bridge: CustodySetup;
  /** The caps both wallets were made with: the suite's, then the routes' tokens'. */
  readonly caps: ChainCaps;
  readonly routeCaps: ChainCaps["approvals"];
}

// The 24-hour caps of the routes' tokens: 1,000 base units of BSC's USDC and of its ETH each.
const routeCapPlan: ChainCapPlan = {
  chain: testChain,
  nativeLimitBase: 1n,
  approvals: [
    { token: bscUsdc, limitBase: 1_000n },
    { token: bscEth, limitBase: 1_000n },
  ],
};

// The routes' token caps, made once on the subject's app.
async function routeCapsOn(subject: PrivyCustodySubject): Promise<ChainCaps["approvals"]> {
  const { api, ownerKey } = subject;
  const owner = await api.createKeyQuorum(
    { publicKey: ownerKey, displayName: "binference test owner" },
    live(),
  );
  const listed = aggregationsOf(routeCapPlan);
  assert.ok(listed.ok);
  const [, ...approvals] = listed.value;
  const ids: string[] = [];
  for (const definition of approvals) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- one write at a time, as every write
    ids.push(await api.createAggregation({ definition, owner: owner.id }, live()));
  }
  return routeCapPlan.approvals.map((item, index) => ({
    aggregation: ids[index] ?? "",
    limitBase: item.limitBase,
    token: item.token,
  }));
}

const made = new WeakMap<PrivyCustodySubject, Promise<Wallets>>();

function ceilingOf(
  kind: "main" | "bridge",
  routeCaps: ChainCaps["approvals"],
): (caps: ChainCaps) => Ceiling {
  return (caps) => {
    const built = buildCeiling(testStakingCeilingRequest(caps, { kind, routeCaps }));
    assert.ok(built.ok);
    return built.value;
  };
}

const id = (n: string) => idSchema("wal").parse(`wal_0190f1c2-3b4c-7d5e-8f60-71829300000${n}`);

// A wallet that bridges, stakes and registers, and a bridge wallet, beside the suite's wallet and
// under its 24-hour caps, so the suite makes no more aggregations.
async function makeWallets(subject: PrivyCustodySubject): Promise<Wallets> {
  const caps = heldCapsOf(await setUp(subject));
  const routeCaps = await routeCapsOn(subject);
  const main = await walletUnder(subject, {
    ceiling: ceilingOf("main", routeCaps),
    caps,
    id: id("1"),
  });
  const bridge = await walletUnder(subject, {
    ceiling: ceilingOf("bridge", routeCaps),
    caps,
    id: id("2"),
  });
  return { main, bridge, caps, routeCaps };
}

/** A check run on the bridge checks' wallets, made once per subject. */
export function bridgeCheck(
  harness: PrivyCustodyHarness,
  name: string,
  run: (wallets: Wallets) => Promise<void>,
): ContractCheck {
  return sharedWalletsCheck(harness, { made, make: makeWallets }, { name, run });
}

/** Whether Privy signs the call from the wallet. */
export async function signs(setup: CustodySetup, call: TestCall): Promise<boolean> {
  return (await askPrivy(setup, { call })).ok;
}

/** Fails unless Privy signs the call from the wallet. */
export async function privySigns(setup: CustodySetup, call: TestCall): Promise<void> {
  assert.ok(await signs(setup, call), `Privy refused a call inside the ceiling to ${call.to}.`);
}

/** Fails unless Privy refuses the call from the wallet as outside its ceiling. */
export async function privyRefuses(setup: CustodySetup, call: TestCall): Promise<void> {
  assert.deepEqual(await askPrivy(setup, { call }), refused);
}

/** An Across `depositV3` from the wallet, by default of USDC to the address saved for Base. */
export function depositCall(
  setup: CustodySetup,
  args: Partial<DepositArgs>,
  valueWei = 0n,
): TestCall {
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

// A 32-byte `depositTo` from the wallet of USDC to Solana, by default to the saved address.
function solanaDepositCall(setup: CustodySetup, args: Partial<DepositArgs>): TestCall {
  const data = depositToData({
    depositor: hexOf(setup.wallet.address),
    recipient: solanaSaved,
    inputToken: bscUsdc,
    outputToken: solanaUsdc,
    destinationChainId: BigInt(solanaBridgeId),
    ...args,
  });
  return call(spokePool, data);
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
    bridgeCheck(harness, "signs a 32-byte deposit to an address saved for Solana", async (w) => {
      await privySigns(w.main, solanaDepositCall(w.main, {}));
    }),
    bridgeCheck(
      harness,
      "signs an ETH approval within its 24-hour cap, none past it",
      async (w) => {
        await privySigns(w.main, call(bscEth, approveTo(spokePool, 1_000n)));
        await privyRefuses(w.main, call(bscEth, approveTo(spokePool, 1_001n)));
      },
    ),
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
    bridgeCheck(harness, "refuses a 32-byte deposit to an unsaved Solana address", async (w) => {
      await privyRefuses(w.main, solanaDepositCall(w.main, { recipient: solanaUnsaved }));
      await privyRefuses(w.main, solanaDepositCall(w.main, { recipient: baseSaved }));
      await privyRefuses(w.main, solanaDepositCall(w.main, { destinationChainId: 8453n }));
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

/**
 * The bridge, staking and identity rules on Privy (decisions 0302 to 0304): deposits to addresses
 * saved for each chain and staking that credits the wallet signed, every deposit to another
 * address or chain refused, and Relay's deposits signed from a bridge wallet alone.
 */
export function bridgeStakingChecks(harness: PrivyCustodyHarness): readonly ContractCheck[] {
  return [...acceptChecks(harness), ...refuseChecks(harness)];
}
