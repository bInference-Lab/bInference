import type { BridgePathOptions } from "../bridges/propose-bridge.js";
import { withBridges } from "../bridges/with-bridges.js";
import type { CapGate } from "../confirmations/cap-gate.js";
import type { LowGasAlerts } from "../gas/low-gas-alerts.js";
import { createIdentityHost } from "../identity/identity-host.js";
import type { IdentityPathOptions } from "../identity/propose-identity.js";
import { withIdentities } from "../identity/with-identities.js";
import type { StoredIntents } from "../intents/create-stored-intents.js";
import { createMoneyPath, type MoneyPathOptions } from "../money-path/create-money-path.js";
import type { ExecuteConfirmed } from "../money-path/execute-confirmed.js";
import type { LaunchRouting } from "../money-path/launch-routing.js";
import { type LaunchingMoneyPath, withLaunches } from "../money-path/launching-money-path.js";
import type { LaunchPathOptions } from "../money-path/resolve-launch.js";
import type { PaperParts } from "../paper/paper-parts.js";
import { createPolicyCheck } from "../policy/check-policy.js";
import type { TransferPathOptions } from "../sends/propose-transfer.js";
import { withTransfers } from "../sends/with-transfers.js";
import type { StakePathOptions } from "../staking/propose-stake.js";
import { withStakes } from "../staking/with-stakes.js";
import { createStakingHost } from "../venues/staking-host.js";
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

// What a send or an approval revoke runs on beyond the money path's ports: the install's wallets
// and rescue address, the name resolvers, and the chain's simulator on live balances.
function transferPathOf(options: EngineOptions, path: MoneyPathOptions): TransferPathOptions {
  const { stores, chainSimulator, nameResolvers = [] } = options;
  const { install, intents } = stores;
  return { ...path, install, intents, simulator: chainSimulator, nameResolvers };
}

// What a bridge runs on beyond the money path's ports: the install, the bridges and their routes,
// the chains they deliver to, the code readers, the wallets' stored ceilings and the chain's
// simulator on live balances.
function bridgePathOf(options: EngineOptions, path: MoneyPathOptions): BridgePathOptions {
  const { stores, chainSimulator, bridges = [], destinations = [], codeReaders = [] } = options;
  const { install } = stores;
  const ceilings = options.ceilings;
  return {
    ...path,
    install,
    bridges,
    destinations,
    codeReaders,
    ceilings,
    simulator: chainSimulator,
  };
}

// What a staking move runs on beyond the money path's ports: the staking venues through their
// host, the install, the unstakes no claim took, the wallets' stored ceilings and the chain's
// simulator on live balances (decision 0327).
function stakePathOf(options: EngineOptions, path: MoneyPathOptions): StakePathOptions {
  const { stores, chainSimulator, stakingVenues = [], chains, clock } = options;
  const staking = createStakingHost({ venues: stakingVenues, chains, clock });
  return {
    ...path,
    install: stores.install,
    unbondings: stores.unbondings,
    staking,
    ceilings: options.ceilings,
    simulator: chainSimulator,
  };
}

// What an identity registration runs on beyond the money path's ports: the registries through
// their host, the stored identities, the install and the chain's simulator on live balances
// (decision 0335). An engine without identity options runs no registry.
function identityPathOf(options: EngineOptions, path: MoneyPathOptions): IdentityPathOptions {
  const { stores, chainSimulator, identity } = options;
  return {
    ...path,
    identity: createIdentityHost(identity?.registries ?? [], options.chains),
    identities: stores.identities,
    install: stores.install,
    simulator: chainSimulator,
    version: identity?.version ?? "",
  };
}

/**
 * The money path every proposal and order fill runs through, from the engine's options, with
 * sends and approval revokes, and bridges, on their own paths (spec 6, section 5), and token
 * launches on theirs
 * when the options hold a launch host (decision 0234).
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
    ...(options.communityPluginsOn === undefined
      ? {}
      : { communityPluginsOn: options.communityPluginsOn }),
    lowGas,
    gate,
    liveFills: options.liveOrderFills === true,
    clock,
    ids,
  };
  const transfers = withTransfers(createMoneyPath(path), transferPathOf(options, path));
  const bridges = withBridges(transfers, bridgePathOf(options, path));
  const stakes = withStakes(bridges, stakePathOf(options, path));
  const identities = withIdentities(stakes, identityPathOf(options, path));
  return withLaunches(identities, launchPathOf(options, path));
}
