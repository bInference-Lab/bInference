import type { Fork } from "@binference/chain-evm/fork";
import { createIdSource } from "@binference/core";
import { createMemoryWorkspaceFiles, createSeededRandom } from "@binference/core/testing";
import type { EngineOptions } from "@binference/engine";
import { selfHostedChains } from "../compose/open-engine-parts.js";
import { createSystemClock } from "../runtime/system-clock.js";
import { forkTokenFacts } from "./fork-trading.js";

/** What every fork rig gives its engine alike. */
type ForkEngineBasics = Pick<
  EngineOptions,
  | "paperBalances"
  | "isLocked"
  | "canPrice"
  | "readTokenFacts"
  | "workspace"
  | "chains"
  | "clock"
  | "ids"
  | "random"
  | "publish"
  | "ownerTimeZone"
>;

/**
 * What every fork rig gives its engine alike: the self-hosted chains on the system clock, the
 * fork's own token facts, no paper balances, an engine never locked that can price anything, a
 * workspace in memory, ids and randomness seeded from `seed`, and nothing published.
 */
export function forkEngineBasics(fork: Fork, seed: number): ForkEngineBasics {
  const clock = createSystemClock();
  return {
    paperBalances: [],
    isLocked: () => false,
    canPrice: async () => await Promise.resolve(true),
    readTokenFacts: forkTokenFacts(fork),
    workspace: createMemoryWorkspaceFiles(clock),
    chains: selfHostedChains(),
    clock,
    ids: createIdSource({ clock, random: createSeededRandom(seed) }),
    random: createSeededRandom(seed + 1),
    publish: () => undefined,
    ownerTimeZone: () => "UTC",
  };
}
