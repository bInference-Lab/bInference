import type { CapGate } from "../confirmations/cap-gate.js";
import type { LowGasAlerts } from "../gas/low-gas-alerts.js";
import type { StoredIntents } from "../intents/create-stored-intents.js";
import { createMoneyPath, type MoneyPathOptions } from "../money-path/create-money-path.js";
import type { ExecuteConfirmed } from "../money-path/execute-confirmed.js";
import type { LaunchRouting } from "../money-path/launch-routing.js";
import { type LaunchingMoneyPath, withLaunches } from "../money-path/launching-money-path.js";
import type { LaunchPathOptions } from "../money-path/resolve-launch.js";
import type { PaperParts } from "../paper/paper-parts.js";
import { createPolicyCheck } from "../policy/check-policy.js";
import type { EngineOptions } from "./create-engine.js";

// What a token launch runs on beyond the money path's ports: the launch host, the owner's
// uploads, the chain's simulator on live balances, and the notices (decision 0234).
function launchPathOf(
  options: EngineOptions,
  path: MoneyPathOptions,
): LaunchPathOptions | undefined {
  const { launchHost, launchTokenCode, launchImages, chainSimulator, publish, stores } = options;
  if (launchHost === undefined || launchTokenCode === undefined) {
    return undefined;
  }
  const images = launchImages === undefined ? {} : { images: launchImages };
  const simulator = chainSimulator;
  const launch = { host: launchHost, readCode: launchTokenCode, simulator, publish, ...images };
  return { ...path, install: stores.install, launch };
}

/**
 * The money path every proposal and order fill runs through, from the engine's options, with
 * token launches on their own path when the options hold a launch host (decision 0234).
 */
export function moneyPathOf(
  options: EngineOptions,
  parts: {
    readonly stored: StoredIntents;
    readonly paper: PaperParts;
    readonly launches: LaunchRouting;
    readonly execute: ExecuteConfirmed;
    readonly lowGas: LowGasAlerts;
    readonly gate: CapGate;
  },
): LaunchingMoneyPath {
  const { stores, custody, host, chains, clock, ids, isLocked } = options;
  const { stored, paper, launches, execute, lowGas, gate } = parts;
  const path: MoneyPathOptions = {
    stored,
    agents: stores.agents,
    custody,
    wallets: paper.wallets,
    holdings: paper.holdings,
    launches,
    policy: createPolicyCheck({ prices: options.prices, clock }),
    prices: options.prices,
    host,
    risk: options.risk,
    simulator: paper.simulator,
    chains,
    readTokenFacts: options.readTokenFacts,
    execute,
    isLocked,
    lowGas,
    gate,
    liveFills: options.liveOrderFills === true,
    clock,
    ids,
  };
  return withLaunches(createMoneyPath(path), launchPathOf(options, path));
}
