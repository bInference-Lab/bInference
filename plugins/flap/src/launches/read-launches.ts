import {
  type AccountRef,
  accountRefParts,
  accountRefSchema,
  type Bps,
  bpsSchema,
  type ChainRef,
  type FoundLaunch,
  type LaunchChange,
  type LaunchesFound,
  type LaunchLogsRequest,
} from "@binference/plugin-sdk";
import { type CurveChainSetup, curveAssetOf } from "@binference/plugin-sdk/evm";
import { type Address, zeroAddress } from "viem";
import { z } from "zod";
import { portalAccountOf } from "../flap-assets.js";
import { type PortalEvent, portalEventOf } from "../portal/portal-events.js";
import type { VenueParts } from "../venue-parts.js";

// Every Flap token has 18 decimals.
const tokenDecimals = 18;
// The Portal's progress of a full curve.
const fullProgress = 10n ** 18n;
const fullBps = 10_000n;
const none: LaunchesFound = { launches: [], changes: [] };
const bpsFromBase = z.bigint().pipe(z.coerce.number()).pipe(bpsSchema);

type Created = Extract<PortalEvent, { readonly kind: "created" }>;

const accountOn = (chain: ChainRef, address: Address): AccountRef =>
  accountRefSchema.parse(`${chain}:${address}`);

// A share of a whole in basis points, rounded down; one past the whole is unreadable.
function bpsOf(part: bigint, whole: bigint): Bps | undefined {
  const bps = (part * fullBps) / whole;
  return bps > fullBps ? undefined : bpsFromBase.parse(bps);
}

function ofToken<K extends PortalEvent["kind"]>(
  events: readonly PortalEvent[],
  kind: K,
  token: Address,
): readonly Extract<PortalEvent, { readonly kind: K }>[] {
  return events.filter(
    (event): event is Extract<PortalEvent, { readonly kind: K }> =>
      event.kind === kind && event.token === token,
  );
}

// The curve's last progress and its graduation among the events of one token.
function curveOf(
  events: readonly PortalEvent[],
  token: Address,
): Pick<LaunchChange, "curveProgressBps" | "graduated"> {
  const progress = ofToken(events, "progress", token).at(-1)?.progress;
  const bps = progress === undefined ? undefined : bpsOf(progress, fullProgress);
  const graduated = ofToken(events, "graduated", token).length > 0;
  return {
    ...(bps === undefined ? {} : { curveProgressBps: bps }),
    ...(graduated ? { graduated } : {}),
  };
}

function launchOf(setup: CurveChainSetup, events: readonly PortalEvent[], created: Created) {
  const { chain } = setup;
  const { token, creator, name, symbol, index } = created;
  const quoteToken = ofToken(events, "quote", token).at(-1)?.quoteToken ?? zeroAddress;
  const tax = ofToken(events, "tax", token).at(-1)?.taxBps ?? 0n;
  const taxBps = tax > fullBps ? undefined : bpsFromBase.parse(tax);
  const buyers = new Set(ofToken(events, "bought", token).map(({ buyer }) => buyer));
  const { curveProgressBps, graduated } = curveOf(events, token);
  const launch: FoundLaunch = {
    token: curveAssetOf(token, setup),
    creator: accountOn(chain, creator),
    quoteAsset: curveAssetOf(quoteToken, setup),
    symbol,
    name,
    decimals: tokenDecimals,
    ...(taxBps === undefined ? {} : { taxBps }),
    curveProgressBps: curveProgressBps ?? bpsSchema.parse(0),
    graduated: graduated === true,
    insiders: [...buyers].map((buyer) => accountOn(chain, buyer)),
    index,
  };
  return launch;
}

// A curve change for each token the transaction moved but did not create.
function changesOf(
  setup: CurveChainSetup,
  events: readonly PortalEvent[],
  created: ReadonlySet<Address>,
): readonly LaunchChange[] {
  const moved = events.filter(
    (event) =>
      (event.kind === "progress" || event.kind === "graduated") && !created.has(event.token),
  );
  const tokens = [...new Set(moved.map(({ token }) => token))];
  return tokens.flatMap((token) => {
    const last = moved.findLast((event) => event.token === token);
    const curve = curveOf(events, token);
    return last === undefined
      ? []
      : [{ token: curveAssetOf(token, setup), ...curve, index: last.index }];
  });
}

/**
 * The launches and curve changes one transaction's logs tell (decision 0254), from the Portal's
 * events alone: each `TokenCreated` the registry's Portal wrote is a launch, with the quote token
 * its `TokenQuoteSet` names (the chain's coin when none does), the tax its `FlapTokenTaxSet` names
 * (none when none does), the wallets that bought it in the same transaction as insiders, and its
 * curve's last progress and graduation there. A token's progress or graduation in a transaction
 * that did not create it is a change. A log of any other contract, or outside its shape, is passed
 * over; a chain the venue does not trade on has none.
 */
export function readFlapLaunches(request: LaunchLogsRequest, parts: VenueParts): LaunchesFound {
  const setup = parts.setups.get(request.chain);
  if (setup === undefined) {
    return none;
  }
  const portal = accountRefParts(portalAccountOf(request.contracts)).address.toLowerCase();
  const events = request.logs
    .filter(({ emitter }) => accountRefParts(emitter).address.toLowerCase() === portal)
    .flatMap((log) => portalEventOf(log) ?? []);
  const created = events.filter((event): event is Created => event.kind === "created");
  const tokens = new Set(created.map(({ token }) => token));
  return {
    launches: created.map((event) => launchOf(setup, events, event)),
    changes: changesOf(setup, events, tokens),
  };
}
