import { accountRefParts } from "@binference/chain";
import type { JsonValue } from "@binference/core";
import type { ProtocolId } from "@binference/protocol";
import { type Address, getAddress, toHex } from "viem";
import { beforeAll, describe, expect, inject, it, onTestFailed } from "vitest";
import {
  type CrashAcross,
  crashBridgeAmount,
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
import { type CrashRelay, crashRelayDepository, installCrashRelay } from "./crash-relay.js";
import type { CrashInstall, CrashWorld } from "./crash-runs.js";

// Each run bridges 20 USDC through Relay from a fresh install's bridge wallet to an address saved
// for Base, as the owner does from the CLI: the bridge wallet made with the owner key and funded
// from outside, an exact approval, then the deposit naming Relay's order. The test kills the
// engine outright at the run's point of the deposit, between its signature and its send, between
// the send and the receipt, once the receipt is stored, or as the engine first reads the delivery;
// a second engine on the same folder recovers, follows the bridge and books its delivery. Relay's
// depository stands in on the bare chain, and Relay's API and Base answer on loopback, every order
// signed by the crash suite's own solver, which only the crash engine takes as Relay's.
const crash: CrashContext = inject("crash");
const harness = useCrashHarness(crash, { seed: 53 });
const runs = Array.from({ length: crash.runs }, (_, index) => index + 1);
const held: { across?: CrashAcross; relay?: CrashRelay; entry?: ProtocolId<"addressBook"> } = {};

beforeAll(async () => {
  const { chain, services } = harness.worldOf();
  const anvil = async (method: string, params: readonly JsonValue[]) => chain.call(method, params);
  const across = await installCrashAcross(anvil);
  const relay = await installCrashRelay(anvil, across.baseChain);
  services.route("relay", relay.api);
  services.route("base", across.base);
  Object.assign(held, { across, relay });
});

function installed(): { readonly across: CrashAcross; readonly relay: CrashRelay } {
  const { across, relay } = held;
  if (across === undefined || relay === undefined) {
    throw new Error("Relay was not installed.");
  }
  return { across, relay };
}

// The owner makes the agent's bridge wallet with the owner key, as `binference wallet create
// --bridge` does, funds it from outside with 1 BNB and the 20 USDC it bridges, lets the agent
// bridge through Relay and saves the recipient for Base. The recipient holds no code there.
async function prepare(world: CrashWorld, install: CrashInstall): Promise<Address> {
  const anvil = async (method: string, params: readonly JsonValue[]) =>
    world.chain.call(method, params);
  installed().across.plainOnBase(crashBaseRecipient);
  await allowVenue(install, "relay");
  const made: { address?: Address } = {};
  held.entry = await savedForBase(install, async ({ client, agent, ownerKey, call }) => {
    const args = { agent, label: "Bridges", ownerKey, bridge: true } as const;
    const wallet = await client.call("wallet/create", args, call);
    made.address = getAddress(accountRefParts(wallet.address).address);
  });
  if (made.address === undefined) {
    throw new Error("The bridge wallet was not made.");
  }
  await world.chain.call("anvil_setBalance", [made.address, toHex(10n ** 18n)]);
  await fundCrashUsdc(anvil, made.address, crashBridgeAmount);
  return made.address;
}

const bridge: IntentRun = {
  executions: 0,
  requestOf: bridgeToBase(() => held.entry),
  prepare,
  // The depository takes the 20 USDC once, and the bridge is delivered once by Relay's fill.
  effect: {
    read: async (world) => usdcHeldBy(world, crashRelayDepository),
    moves: crashBridgeAmount,
  },
  rows: { read: deliveredOf, landed: 1 },
};

describe.each(bridgeKillCases(async () => installed().relay.holdNextStatus()))(
  "an engine killed at $point of its deposit during a bridge through Relay",
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
