import {
  BinferenceError,
  type LaunchBuild,
  type LaunchBuildRequest,
  type LaunchPicture,
  type TxDraft,
} from "@binference/plugin-sdk";
import { findCreate2Salt } from "@binference/plugin-sdk/evm";
import { type Address, getAddress, hexToBytes, zeroAddress } from "viem";
import { brewAssetOf } from "../brew-setups.js";
import {
  addressAnswerOf,
  predictDistributorData,
  predictTokenData,
} from "../contracts/launch-call.js";
import { readBrew } from "../contracts/read-brew.js";
import { distributorAddressOf } from "./brew-distributor.js";
import { saltPrefixOf, type TokenCreate, tokenInitCodeHash } from "./brew-token.js";
import { launchMetadataOf } from "./launch-metadata.js";
import { type BuiltLaunch, builtKeyOf, keepBuilt, type LaunchParts } from "./launch-parts.js";
import { type BrewLaunchSettings, brewSettingsOf } from "./launch-settings.js";
import {
  addressOf,
  checkFirstBuy,
  launchStepsOf,
  type PlacedLaunch,
  placeOf,
  tickSpacing,
  tokenSupply,
} from "./launch-steps.js";
import { readFactory } from "./quote-launch.js";
import { startTickOf } from "./start-tick.js";

// The last two bytes every Brew token's address ends in, 6666, as Brew's own launches do
// (decision 0283).
const suffix = [0x66, 0x66] as const;

function refuse(message: string): BinferenceError {
  return new BinferenceError({ code: "brew.no_route", message });
}

// A salt for the token whose address ends in 6666, found off line, and that address, which the
// factory's own `predictTokenAddress` must give too.
async function tokenOf(
  create: TokenCreate,
  parts: { readonly launchParts: LaunchParts; readonly placed: PlacedLaunch },
  signal: AbortSignal,
) {
  const search = {
    deployer: create.factory,
    initCodeHash: tokenInitCodeHash(create),
    suffix,
    saltPrefix: hexToBytes(saltPrefixOf(create.creator)),
  };
  const found = await findCreate2Salt(search, { random: parts.launchParts.random, signal });
  if (found === undefined) {
    throw refuse("No salt gives a Brew token address ending in 6666; launch again.");
  }
  const read = { rpc: parts.placed.chain.rpc, signal };
  const data = predictTokenData({ ...create, salt: found.salt });
  const what = "the token's predicted address";
  const predicted = await readBrew(read, { to: create.factory, data, what }, addressAnswerOf);
  if (getAddress(predicted) !== found.address) {
    throw refuse(
      "BrewFactory predicts another address for the token than its creation code gives.",
    );
  }
  return found;
}

// The holder distributor the token will get: its CREATE2 address worked out off line from the
// registry's two factories, which the distributor factory's own `predict` must give too, and
// never the zero address, which BrewFactory would read as the launch wallet.
async function distributorOf(placed: PlacedLaunch, token: Address, signal: AbortSignal) {
  const factories = { distributorFactory: placed.distributorFactory, brewFactory: placed.factory };
  const address = distributorAddressOf(factories, token);
  const read = { rpc: placed.chain.rpc, signal };
  const data = predictDistributorData(token);
  const what = "the token's holder distributor";
  const to = placed.distributorFactory;
  const predicted = await readBrew(read, { to, data, what }, addressAnswerOf);
  if (getAddress(predicted) !== address || address === zeroAddress) {
    throw refuse(
      "The distributor factory predicts another holder distributor than its creation code gives.",
    );
  }
  return address;
}

// What the decoder reads of the call beyond its bytes, kept by the call itself.
function keep(parts: LaunchParts, steps: readonly TxDraft[], built: BuiltLaunch): void {
  const create = steps.at(-1);
  if (create !== undefined) {
    keepBuilt(parts, builtKeyOf(create), built);
  }
}

/** A build request the launcher takes: placed, with its settings, picture and starting tick. */
interface CheckedBuild {
  readonly placed: PlacedLaunch;
  readonly settings: BrewLaunchSettings;
  readonly picture: LaunchPicture;
  readonly initialTick: number;
}

// The request on a chain and pair the venue launches on, with the owner's picture, a first buy's
// minimum above 0, and a start a tick reaches; any other request throws.
function checkedOf(request: LaunchBuildRequest, parts: LaunchParts): CheckedBuild {
  checkFirstBuy(request);
  const placed = placeOf(request, parts);
  const settings = brewSettingsOf(request.options);
  const { picture, firstBuyMinOut: minimum } = request;
  if (placed === undefined || picture === undefined) {
    throw refuse("Brew launches here only on its chains and pairs, with the owner's picture.");
  }
  if (request.firstBuy !== undefined && (minimum ?? 0n) === 0n) {
    throw refuse("A first buy on Brew takes a minimum above 0.");
  }
  const marketCapBase = settings.startMarketCap;
  const initialTick = startTickOf({ marketCapBase, supplyBase: tokenSupply, spacing: tickSpacing });
  if (initialTick === undefined) {
    throw refuse("No pool tick reaches the launch's starting market cap.");
  }
  return { placed, settings, picture, initialTick };
}

/**
 * Builds a Brew launch from the launch wallet (decision 0283): an exact approval of the factory
 * for a token first buy, then one `launch` call. It writes the card's words and the owner's
 * picture into the metadata address, a 1% pool with the whole supply in one range from the
 * starting price's tick, the owner's fee recipient or the token's holder distributor, which it
 * names as the worked-out `holderDistributor` and holds to its off-line address, the first
 * buy for the wallet at the host's minimum, a salt found off line so the token's address ends in
 * 6666, and the quoted fee as both the call's fee and the most it consents to. A fee other than
 * the quoted one, paused launches, a first buy without a minimum, a missing picture, and a chain
 * or pair the venue does not launch on each throw.
 */
export async function buildLaunch(
  request: LaunchBuildRequest,
  parts: LaunchParts,
  signal: AbortSignal,
): Promise<LaunchBuild> {
  signal.throwIfAborted();
  const checked = checkedOf(request, parts);
  const { placed, settings, initialTick } = checked;
  const factory = await readFactory(placed, signal);
  if (factory.isPaused || factory.fee !== request.fee.base) {
    throw refuse("Brew's launches are paused, or its fee is no longer the quoted one.");
  }
  const metadataURI = launchMetadataOf(request, checked.picture);
  const create = {
    factory: placed.factory,
    creator: addressOf(request.wallet),
    name: request.name,
    symbol: request.symbol,
    totalSupply: tokenSupply,
    metadataURI,
  };
  const found = await tokenOf(create, { launchParts: parts, placed }, signal);
  const distributor = settings.holderRewards
    ? await distributorOf(placed, found.address, signal)
    : undefined;
  const feeRecipient = distributor ?? settings.feeRecipient;
  if (feeRecipient === undefined) {
    throw refuse("A launch with holder rewards off names its fee recipient.");
  }
  const minimum = request.firstBuyMinOut === undefined ? {} : { minimum: request.firstBuyMinOut };
  const write = { fee: factory.fee, metadataURI, initialTick, feeRecipient, salt: found.salt };
  const steps = launchStepsOf(request, placed, { ...write, ...minimum });
  const kept = { factory: placed.factory, distributorFactory: placed.distributorFactory };
  keep(parts, steps, { startMarketCap: settings.startMarketCap, ...kept });
  // The card shows the holder distributor whole, and the create call must name it.
  const worked = distributor === undefined ? {} : { settings: { holderDistributor: distributor } };
  return { token: brewAssetOf(found.address, placed.chain.setup), steps, ...worked };
}
