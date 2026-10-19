import {
  type AccountRef,
  accountRefParts,
  accountRefSchema,
  type Bps,
  bpsSchema,
  type ChainRef,
  type FoundLaunch,
  type LaunchChange,
  type LaunchCompletion,
  type LaunchesFound,
  type LaunchFacts,
  type LaunchLogsRequest,
  type ReadAnswer,
} from "@binference/plugin-sdk";
import { type CurveChainSetup, curveAssetOf } from "@binference/plugin-sdk/evm";
import type { Address } from "viem";
import { z } from "zod";
import {
  curveFactCalls,
  curveGraduatedOf,
  curveNumberOf,
  type LaunchEvent,
  launchEventOf,
  tokenWordCalls,
  tokenWordOf,
} from "../contracts/genius-launch-events.js";
import { factoriesOf } from "../geniusfun-contracts.js";
import type { VenueParts } from "../venue-parts.js";

// Every Genius.fun token has 18 decimals.
const tokenDecimals = 18;
const fullBps = 10_000n;
const none: LaunchesFound = { launches: [], changes: [] };
const bpsFromBase = z.bigint().pipe(z.coerce.number()).pipe(bpsSchema);

type Launched = Extract<LaunchEvent, { readonly kind: "launched" }>;

/** A launch event and the contract that wrote it, in lowercase. */
interface Written {
  readonly event: LaunchEvent;
  readonly by: string;
}

const lower = (address: string): string => address.toLowerCase();
const accountOn = (chain: ChainRef, address: Address): AccountRef =>
  accountRefSchema.parse(`${chain}:${address}`);

// A number of basis points; one past the whole is unreadable.
function bpsOf(value: bigint | undefined): Bps | undefined {
  return value === undefined || value > fullBps ? undefined : bpsFromBase.parse(value);
}

// The curve's progress: the tokens it sold over the tokens it had to sell, rounded down.
function progressOf(supply?: bigint, reserved?: bigint, sellable?: bigint): Bps | undefined {
  if (supply === undefined || reserved === undefined || sellable === undefined) {
    return undefined;
  }
  const toSell = supply - reserved;
  const sold = toSell - sellable;
  return toSell <= 0n || sold < 0n ? undefined : bpsOf((sold * fullBps) / toSell);
}

// Each fact given, none left `undefined`.
function known(facts: {
  readonly [K in keyof LaunchFacts]-?: LaunchFacts[K] | undefined;
}): LaunchFacts {
  const { symbol, name, taxBps, snipeTaxBps, curveProgressBps, graduated } = facts;
  return {
    ...(symbol === undefined ? {} : { symbol }),
    ...(name === undefined ? {} : { name }),
    ...(taxBps === undefined ? {} : { taxBps }),
    ...(snipeTaxBps === undefined ? {} : { snipeTaxBps }),
    ...(curveProgressBps === undefined ? {} : { curveProgressBps }),
    ...(graduated === undefined ? {} : { graduated }),
  };
}

// The facts the curve's and the token's answers tell, in the order of the completion's calls.
function factsOf(answers: readonly ReadAnswer[]): LaunchFacts {
  const [tax, snipeTax, supply, reserved, sellable, graduated, symbol, name] = answers;
  return known({
    taxBps: bpsOf(curveNumberOf(tax)),
    snipeTaxBps: bpsOf(curveNumberOf(snipeTax)),
    curveProgressBps: progressOf(
      curveNumberOf(supply),
      curveNumberOf(reserved),
      curveNumberOf(sellable),
    ),
    graduated: curveGraduatedOf(graduated),
    symbol: tokenWordOf(symbol),
    name: tokenWordOf(name),
  });
}

function completionOf(chain: ChainRef, launched: Launched): LaunchCompletion {
  const curve = accountOn(chain, launched.curve);
  const token = accountOn(chain, launched.token);
  return {
    calls: [
      ...curveFactCalls.map((input) => ({ target: curve, input })),
      ...tokenWordCalls.map((input) => ({ target: token, input })),
    ],
    facts: factsOf,
  };
}

function isGraduation(written: Written, factories: ReadonlySet<string>, token: Address): boolean {
  return (
    written.event.kind === "graduated" && written.event.token === token && factories.has(written.by)
  );
}

function launchOf(
  setup: CurveChainSetup,
  read: { readonly events: readonly Written[]; readonly factories: ReadonlySet<string> },
  launched: Launched,
): FoundLaunch {
  const { chain } = setup;
  const curve = lower(launched.curve);
  const exempted = read.events.flatMap(({ event, by }) =>
    event.kind === "exempted" && by === curve ? [event.account] : [],
  );
  return {
    token: curveAssetOf(launched.token, setup),
    creator: accountOn(chain, launched.creator),
    quoteAsset: curveAssetOf(launched.pairToken, setup),
    decimals: tokenDecimals,
    graduated: read.events.some((written) => isGraduation(written, read.factories, launched.token)),
    insiders: [...new Set(exempted)].map((account) => accountOn(chain, account)),
    index: launched.index,
    complete: completionOf(chain, launched),
  };
}

/**
 * The launches and graduations one transaction's logs tell (decision 0254): each `TokenLaunched`
 * a listed stack's factory wrote is a launch, with its creator and quote token, the wallets its
 * own curve's `SnipeTaxExempted` names in the same transaction as insiders, and the curve and
 * token reads that complete it at the latest block: the creator tax, the starting snipe tax, the
 * curve's progress (tokens sold over tokens to sell), `graduated()`, and the token's symbol and
 * name. A listed factory's `LaunchSwept` or `PoolGraduated` of a token the transaction did not
 * launch is a graduation. A log of any other contract, or outside its shape, is passed over; a
 * chain the venue does not trade on has none.
 */
export function readGeniusLaunches(request: LaunchLogsRequest, parts: VenueParts): LaunchesFound {
  const setup = parts.setups.get(request.chain);
  if (setup === undefined) {
    return none;
  }
  const factories = new Set(factoriesOf(request.contracts).map(({ address }) => lower(address)));
  const events = request.logs.flatMap((log) => {
    const event = launchEventOf(log);
    return event === undefined ? [] : [{ event, by: lower(accountRefParts(log.emitter).address) }];
  });
  const launched = events.flatMap(({ event, by }) =>
    event.kind === "launched" && factories.has(by) ? [event] : [],
  );
  const tokens = new Set(launched.map(({ token }) => token));
  const changes: readonly LaunchChange[] = events.flatMap(({ event, by }) =>
    event.kind === "graduated" && factories.has(by) && !tokens.has(event.token)
      ? [{ token: curveAssetOf(event.token, setup), graduated: true, index: event.index }]
      : [],
  );
  return {
    launches: launched.map((event) => launchOf(setup, { events, factories }, event)),
    changes,
  };
}
