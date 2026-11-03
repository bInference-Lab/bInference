import type { JsonValue } from "@binference/core";
import type { ProtocolId } from "@binference/protocol";
import type { Address } from "viem";
import { beforeAll, describe, expect, inject, it, onTestFailed } from "vitest";
import { storedInstall } from "../e2e/init-fixtures.js";
import {
  type CrashAcross,
  crashBridgeAmount,
  crashSpokePool,
  fundCrashUsdc,
  installCrashAcross,
} from "./crash-across.js";
import {
  allowVenue,
  bridgeKillCases,
  bridgeToBase,
  crashBaseRecipient,
  deliveredOf,
  savedForBase,
  usdcHeldBy,
} from "./crash-bridge-runs.js";
import type { CrashContext } from "./crash-context.js";
import { useCrashHarness } from "./crash-harness.js";
import { crashIntentOnce, type IntentRun, sentOnceOf, sentSummaryOf } from "./crash-intent-runs.js";
import type { CrashInstall, CrashWorld } from "./crash-runs.js";

// Each run bridges 20 USDC from a fresh install's main wallet to an address saved for Base,
// through Across, as the owner does from the CLI: an exact approval, then the deposit. The test
// kills the engine outright at the run's point of the deposit, between its signature and its send,
// between the send and the receipt, once the receipt is stored, or as the engine first reads the
// delivery; a second engine on the same folder recovers, follows the bridge and books its
// delivery. Across's SpokePool stands in on the bare chain, and Across's API and Base answer on
// loopback. What reached the chain is counted by the test's relays and anvil, the signatures by
// the test's Privy, the delivery read from the store.
const crash: CrashContext = inject("crash");
const harness = useCrashHarness(crash, { seed: 47 });
const runs = Array.from({ length: crash.runs }, (_, index) => index + 1);
const held: { across?: CrashAcross; entry?: ProtocolId<"addressBook"> } = {};

beforeAll(async () => {
  const { chain, services } = harness.worldOf();
  const anvil = async (method: string, params: readonly JsonValue[]) => chain.call(method, params);
  held.across = await installCrashAcross(anvil);
  services.route("across", held.across.api);
  services.route("base", held.across.base);
});

function acrossOf(): CrashAcross {
  if (held.across === undefined) {
    throw new Error("Across was not installed.");
  }
  return held.across;
}

// The wallet holds the 20 USDC it bridges. The owner lets the agent bridge through Across: its
// limits and, with the owner key, its wallet's ceiling, as `binference ceiling set` does; and saves
// the recipient for Base with the owner key. The recipient holds no code there.
async function prepare(world: CrashWorld, install: CrashInstall): Promise<Address> {
  const anvil = async (method: string, params: readonly JsonValue[]) =>
    world.chain.call(method, params);
  await fundCrashUsdc(anvil, install.from, crashBridgeAmount);
  acrossOf().plainOnBase(crashBaseRecipient);
  const venues = await allowVenue(install, "across");
  const [wallet] = (await storedInstall(install.machine)).facts.wallets;
  held.entry = await savedForBase(install, async ({ client, ownerKey, call }) => {
    if (wallet === undefined) {
      throw new Error("init made no wallet.");
    }
    await client.call("ceiling/set", { wallet: wallet.id, changes: { venues }, ownerKey }, call);
  });
  return install.from;
}

const bridge: IntentRun = {
  executions: 0,
  requestOf: bridgeToBase(() => held.entry),
  prepare,
  // The SpokePool takes the 20 USDC once, and the bridge is delivered once by Across's fill.
  effect: { read: async (world) => usdcHeldBy(world, crashSpokePool), moves: crashBridgeAmount },
  rows: { read: deliveredOf, landed: 1 },
};

describe.each(bridgeKillCases(async () => acrossOf().holdNextStatus()))(
  "an engine killed at $point of its deposit during a bridge through Across",
  (killCase) => {
    it.each(runs)("sends each step once and books the bridge once, run %i", async () => {
      const outcome = await crashIntentOnce(harness, bridge, killCase);
      onTestFailed(() => {
        process.stderr.write(`${outcome.story}\n`);
      });
      expect(sentSummaryOf(outcome)).toStrictEqual(sentOnceOf(killCase, bridge));
    });
  },
);
