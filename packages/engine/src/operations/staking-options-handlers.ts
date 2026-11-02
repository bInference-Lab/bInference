import { assetRefParts, type ChainRef } from "@binference/chain";
import type { StakingOptions, StakingVenue } from "@binference/chain/staking";
import { err, ok, type Result } from "@binference/core";
import type { ArgsOf, ProtocolErrorCode, ResultOf } from "@binference/protocol";
import type { AgentSettings } from "../agents/agent-record.js";
import { assetInfosOf } from "../money-path/asset-infos.js";
import type { AgentStore, InstallStore } from "../ports.js";
import type { EngineHandler } from "./engine-call.js";
import { portfolioViewOf } from "./portfolio-view.js";
import { type HoldingsReadParts, readHoldings } from "./read-holdings.js";

/** The handler of `staking/options` (protocol spec, section 7.3). */
export interface StakingOptionsHandlers {
  readonly "staking/options": EngineHandler<"staking/options">;
}

/** What `staking/options` reads: the agents, the install's wallets, and their holdings. */
export interface StakingOptionsParts extends HoldingsReadParts {
  readonly agents: Pick<AgentStore, "get">;
  readonly install: Pick<InstallStore, "read">;
}

type Answer = ResultOf<"staking/options">;
type Item = Answer["items"][number];

interface Call {
  readonly signal: AbortSignal;
}

// Each validator the venue lists; a liquid venue's one pool is marked (decision 0331).
function venueItems(venue: StakingVenue, read: StakingOptions): readonly Item[] {
  const pool = venue.pool === undefined ? {} : { pool: true as const };
  return read.validators.map(({ validator, name, commissionBps, aprBps, jailed }) => ({
    venue: venue.id,
    validator,
    ...pool,
    name,
    commissionBps,
    ...(aprBps === undefined ? {} : { aprBps }),
    jailed,
    unbondingSeconds: read.unbondingSeconds,
    minAmount: read.minStake,
  }));
}

// The agent's stakes on the chain, in its mode.
async function positionsOf(
  parts: StakingOptionsParts,
  settings: AgentSettings,
  call: Call & { readonly chain: ChainRef },
): Promise<NonNullable<Answer["positions"]>> {
  const { wallets } = await parts.install.read(call);
  const held = wallets.filter(
    (wallet) => wallet.agentId === settings.agent.id && wallet.archivedAtMs === undefined,
  );
  const read = await readHoldings(parts, held, call);
  const isPaper = settings.agent.mode === "paper";
  const view = portfolioViewOf(read.holdings, parts.chains, read.elsewhere);
  return (view.staking ?? []).filter(
    (stake) => stake.paper === isPaper && assetRefParts(stake.claimable.asset).chain === call.chain,
  );
}

// The validators of each staking venue on the chain, of `venue` alone when named and of the
// agent's venues when it names one; any venue that does not answer fails the read.
async function itemsOf(
  parts: StakingOptionsParts,
  asked: { readonly args: ArgsOf<"staking/options">; readonly settings?: AgentSettings },
  call: Call,
): Promise<Result<readonly Item[], "venue_down">> {
  const { args, settings } = asked;
  const venues = parts.staking
    .venuesOn(args.chain)
    .filter((venue) => args.venue === undefined || venue.id === args.venue)
    .filter((venue) => settings === undefined || settings.limits.venues.includes(venue.id));
  const read = await Promise.all(venues.map(async (venue) => parts.staking.options(venue, call)));
  const items = read.flatMap((answer, index) => {
    const venue = venues[index];
    return answer.ok && venue !== undefined ? venueItems(venue, answer.value) : [];
  });
  return read.every((answer) => answer.ok) ? ok(items) : err("venue_down");
}

// The info of the coins and receipt tokens the answer names that the registry lists.
function assetsOf(
  parts: StakingOptionsParts,
  items: readonly Item[],
  held: NonNullable<Answer["positions"]>,
): Answer["assets"] {
  const named = [
    ...items.flatMap(({ minAmount }) => (minAmount === undefined ? [] : [minAmount.asset])),
    ...held.flatMap(({ staked, claimable }) =>
      staked === undefined ? [claimable.asset] : [staked.asset, claimable.asset],
    ),
  ];
  return assetInfosOf(parts.chains, [...new Set(named)]);
}

// The agent the read names, none when it names none.
async function settingsOf(
  parts: StakingOptionsParts,
  args: ArgsOf<"staking/options">,
  call: Call,
): Promise<Result<AgentSettings | undefined, "agent.not_found">> {
  if (args.agent === undefined) {
    return ok(undefined);
  }
  const settings = await parts.agents.get(args.agent, call);
  return settings === undefined ? err("agent.not_found") : ok(settings);
}

async function optionsOf(
  parts: StakingOptionsParts,
  args: ArgsOf<"staking/options">,
  call: Call,
): Promise<Result<Answer, ProtocolErrorCode>> {
  if (!parts.chains.get(args.chain).ok) {
    return err("protocol.bad_args");
  }
  const found = await settingsOf(parts, args, call);
  if (!found.ok) {
    return found;
  }
  const settings = found.value;
  const items = await itemsOf(
    parts,
    { args, ...(settings === undefined ? {} : { settings }) },
    call,
  );
  if (!items.ok) {
    return err("quote.venue_down");
  }
  const positions =
    settings === undefined
      ? undefined
      : await positionsOf(parts, settings, { ...call, chain: args.chain });
  const assets = assetsOf(parts, items.value, positions ?? []);
  const stakes = positions === undefined ? {} : { positions };
  return ok({ items: items.value, ...stakes, assets });
}

/**
 * Creates the `staking/options` handler: the validators each staking venue the engine runs on the
 * chain lists now, with the venue's unbonding time and least stake, of `venue` alone when named and
 * of the agent's venues when it names an agent, whose stakes on the chain in its mode it adds. A
 * chain the registry lacks is `protocol.bad_args`, an unknown agent `agent.not_found`, and a venue
 * that does not answer `quote.venue_down`. Each validator's name is its operator's own words.
 */
export function createStakingOptionsHandlers(parts: StakingOptionsParts): StakingOptionsHandlers {
  return {
    "staking/options": async ({ args, signal }) => optionsOf(parts, args, { signal }),
  };
}
