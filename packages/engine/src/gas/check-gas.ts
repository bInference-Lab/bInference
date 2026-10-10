import { accountRefSchema, type ChainRegistry } from "@binference/chain";
import { BinferenceError } from "@binference/core";
import type { AgentSettings } from "../agents/agent-record.js";
import type { GasReserve } from "../agents/limits-record.js";
import type { WalletRecord } from "../install/install-record.js";
import { nativeAssetOf } from "../money-path/resolve-proposal.js";
import type { AgentStore, InstallStore, WalletFactsSource } from "../ports.js";
import type { GasReading, LowGasAlerts } from "./low-gas-alerts.js";

/** What the gas check reads through, and the alert it raises. */
export interface GasCheckOptions {
  readonly agents: AgentStore;
  readonly install: InstallStore;
  /** The wallets' live balances on the chain, never paper ones. */
  readonly wallets: WalletFactsSource;
  readonly chains: ChainRegistry;
  /** The money path's alert, so a drop is announced once whoever reads it first. */
  readonly lowGas: LowGasAlerts;
}

interface Call {
  readonly signal: AbortSignal;
}

/** One wallet on one chain where its agent keeps a gas reserve. */
interface GasSpot {
  readonly settings: AgentSettings;
  readonly wallet: WalletRecord;
  readonly reserve: GasReserve;
}

// Every wallet not archived, of every live agent not archived, on each chain it keeps a reserve on.
async function spotsOf(options: GasCheckOptions, call: Call): Promise<readonly GasSpot[]> {
  const [records, { wallets }] = await Promise.all([
    options.agents.list(call),
    options.install.read(call),
  ]);
  const live = records.filter(
    ({ mode, archivedAtMs }) => mode === "live" && archivedAtMs === undefined,
  );
  const settings = await Promise.all(live.map(async ({ id }) => options.agents.get(id, call)));
  return settings.flatMap((agent) =>
    agent === undefined
      ? []
      : wallets
          .filter(
            (wallet) => wallet.agentId === agent.agent.id && wallet.archivedAtMs === undefined,
          )
          .flatMap((wallet) =>
            agent.limits.gasReserve.map((reserve) => ({ settings: agent, wallet, reserve })),
          ),
  );
}

/** A spot's reading, none where its chain is not one of the wallet's family, or why it failed. */
type SpotRead =
  | { readonly kind: "read"; readonly reading?: GasReading }
  | { readonly kind: "failed"; readonly error: BinferenceError };

async function readingOf(options: GasCheckOptions, spot: GasSpot, call: Call): Promise<SpotRead> {
  const chain = options.chains.get(spot.reserve.chain);
  if (!chain.ok || chain.value.definition.family !== spot.wallet.family) {
    return { kind: "read" };
  }
  try {
    const account = accountRefSchema.parse(`${chain.value.ref}:${spot.wallet.address}`);
    const nativeAsset = nativeAssetOf(chain.value);
    const [balance] = await options.wallets.balances({ account, assets: [nativeAsset] }, call);
    const { reserveBase } = spot.reserve;
    const balanceBase = balance?.base ?? 0n;
    const ids = { agent: spot.settings.agent.id, wallet: spot.wallet.id };
    return { kind: "read", reading: { ...ids, account, nativeAsset, balanceBase, reserveBase } };
  } catch (error) {
    call.signal.throwIfAborted();
    const failed =
      error instanceof BinferenceError
        ? error
        : new BinferenceError({
            code: "gas.read_failed",
            message: "A wallet's gas balance could not be read.",
            cause: error,
          });
    return { kind: "failed", error: failed };
  }
}

/**
 * Creates the gas check a timer of the composition root runs (decision 0045): it reads the coin of
 * every wallet of every live agent, archived ones left out, on each chain the agent keeps a gas
 * reserve on, and hands each reading to the low-gas alert, which announces a drop below twice the
 * reserve once, until a later reading shows the wallet topped up. Every wallet is read even when
 * another's read fails; the first failure is thrown once all are checked.
 */
export function createGasCheck(options: GasCheckOptions): (call: Call) => Promise<void> {
  return async (call) => {
    const spots = await spotsOf(options, call);
    const reads = await Promise.all(spots.map(async (spot) => readingOf(options, spot, call)));
    const failures: BinferenceError[] = [];
    for (const read of reads) {
      if (read.kind === "failed") {
        failures.push(read.error);
      } else if (read.reading !== undefined) {
        options.lowGas.check(read.reading);
      }
    }
    const [failure] = failures;
    if (failure !== undefined) {
      throw failure;
    }
  };
}
