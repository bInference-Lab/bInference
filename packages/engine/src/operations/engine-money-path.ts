import type { CapGate } from "../confirmations/cap-gate.js";
import type { LowGasAlerts } from "../gas/low-gas-alerts.js";
import type { StoredIntents } from "../intents/create-stored-intents.js";
import { createMoneyPath, type MoneyPath } from "../money-path/create-money-path.js";
import type { ExecuteConfirmed } from "../money-path/execute-confirmed.js";
import type { LaunchRouting } from "../money-path/launch-routing.js";
import type { PaperParts } from "../paper/paper-parts.js";
import { createPolicyCheck } from "../policy/check-policy.js";
import type { EngineOptions } from "./create-engine.js";

/** The money path every proposal and order fill runs through, from the engine's options. */
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
): MoneyPath {
  const { stores, custody, host, chains, clock, ids, isLocked } = options;
  const { stored, paper, launches, execute, lowGas, gate } = parts;
  return createMoneyPath({
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
  });
}
