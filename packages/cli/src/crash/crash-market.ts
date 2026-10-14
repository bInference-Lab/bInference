import { encodeFixtureRound } from "@binference/chain-evm/fork";
import { bsc } from "@binference/chains";
import { BinferenceError, type JsonValue } from "@binference/core";
import { type Address, getAddress, type Hex, keccak256, pad, toHex } from "viem";
import { assemble, fail, type Item, op, p } from "./crash-assembler.js";
import { crashTokenCode } from "./crash-token.js";

/** Calls anvil itself, past the test's counting and kills. */
type AnvilCall = (method: string, params: readonly JsonValue[]) => Promise<JsonValue>;

/** The USDT base units the crash router pays for each wei of BNB: BNB at $600, USDT at $1. */
export const usdtPerWei = 600n;

function addressIn(list: readonly { readonly address: string }[], what: string): Address {
  const [found] = list;
  if (found === undefined) {
    throw new BinferenceError({ code: "crash.unknown_address", message: `BSC lists no ${what}.` });
  }
  return getAddress(found.address);
}

function contract(venue: string, name: string): Address {
  const named = bsc.contracts.filter((item) => item.venue === venue && item.name === name);
  return addressIn(named, `${venue} ${name}`);
}

/** The registry's USDT, which the crash suite's swaps buy. */
export const crashUsdt: Address = addressIn(
  bsc.tokens.filter((token) => token.symbol === "USDT"),
  "USDT",
);
/** KyberSwap's router, which every crash swap calls. */
export const crashRouter: Address = contract("kyberswap", "meta-aggregation-router-v2");
/** KyberSwap's executor, which the router's calls name. */
export const crashExecutor: Address = contract("kyberswap", "aggregation-executor-proxy");
/** Flap's Portal, which a buy or sale asks whether Flap holds its token on its curve. */
const crashPortal: Address = contract("flap", "portal");
/** Genius.fun's stack factories, which a buy or sale asks whether they launched its token. */
const crashGeniusFactories: readonly Address[] = [
  contract("geniusfun", "factory-m4-2"),
  contract("geniusfun", "factory-m4-1"),
];

// A sale: the router takes the `amount` of the call's `SwapDescriptionV2` from its caller's USDT
// through the allowance the caller left it, then pays the caller a wei for each
// {@link usdtPerWei} units, and reverts when either fails.
const sale: readonly Item[] = [
  { mark: "sale" },
  p(1, 4n),
  op.callDataLoad,
  p(1, 4n),
  op.add,
  op.dup1,
  p(1, 0x60n),
  op.add,
  op.callDataLoad,
  op.add,
  p(1, 0xe0n),
  op.add,
  op.callDataLoad,
  p(4, 0x23b872ddn),
  p(1, 0xe0n),
  op.shl,
  p(1, 0n),
  op.mstore,
  op.caller,
  p(1, 4n),
  op.mstore,
  op.address,
  p(1, 0x24n),
  op.mstore,
  op.dup1,
  p(1, 0x44n),
  op.mstore,
  p(1, 0x20n),
  p(1, 0n),
  p(1, 0x64n),
  p(1, 0n),
  p(1, 0n),
  p(20, BigInt(crashUsdt)),
  op.gas,
  op.call,
  op.isZero,
  { to: "fail" },
  op.jumpI,
  p(2, usdtPerWei),
  op.swap1,
  op.div,
  p(1, 0n),
  p(1, 0n),
  p(1, 0n),
  p(1, 0n),
  op.dup5,
  op.caller,
  op.gas,
  op.call,
  op.isZero,
  { to: "fail" },
  op.jumpI,
  op.stop,
];

/**
 * The runtime code of the crash chain's swap router: a call that sends BNB is paid
 * {@link usdtPerWei} USDT units for each wei, from the router's own USDT; a call that sends none
 * sells USDT for BNB. Either reverts when its transfer fails.
 */
const crashRouterCode: Hex = assemble([
  op.callValue,
  op.isZero,
  { to: "sale" },
  op.jumpI,
  p(4, 0xa9059cbbn),
  p(1, 0xe0n),
  op.shl,
  p(1, 0n),
  op.mstore,
  op.caller,
  p(1, 4n),
  op.mstore,
  op.callValue,
  p(2, usdtPerWei),
  op.mul,
  p(1, 0x24n),
  op.mstore,
  p(1, 0x20n),
  p(1, 0n),
  p(1, 0x44n),
  p(1, 0n),
  p(1, 0n),
  p(20, BigInt(crashUsdt)),
  op.gas,
  op.call,
  op.isZero,
  { to: "fail" },
  op.jumpI,
  op.stop,
  ...sale,
  ...fail,
]);

// The selector of Flap's `TokenNotFound(address)`, the Portal's revert for a token it never made.
const tokenNotFound = BigInt(keccak256(toHex("TokenNotFound(address)")).slice(0, 10));

/**
 * The runtime code of the crash chain's Flap Portal: every call reverts with `TokenNotFound` and
 * the address its first argument names, as the Portal answers for a token Flap never launched, so
 * a buy of USDT goes to the pools.
 */
const crashPortalCode: Hex = assemble([
  p(4, tokenNotFound),
  p(1, 0xe0n),
  op.shl,
  p(1, 0n),
  op.mstore,
  p(1, 4n),
  op.callDataLoad,
  p(1, 4n),
  op.mstore,
  p(1, 0x24n),
  p(1, 0n),
  op.revert,
]);

// The length of `getLaunchedToken`'s answer: its record's 15 fields, one word each.
const launchRecordBytes = 15n * 32n;

/**
 * The runtime code of the crash chain's Genius.fun factories: every call returns a record of
 * zeros, `exists` false among them, as a factory answers for a token it never launched, so a buy
 * of USDT goes to the pools.
 */
const crashGeniusFactoryCode: Hex = assemble([p(2, launchRecordBytes), p(1, 0n), op.return]);

/**
 * Sets up the market a crash run trades in on a bare chain: USDT, KyberSwap's router, a Portal
 * of Flap's and Genius.fun's factories that hold no token, at their BSC addresses, the router
 * holding USDT and BNB to pay out, and fresh rounds of the BNB and USDT feeds.
 */
export async function installCrashMarket(call: AnvilCall): Promise<void> {
  await call("anvil_setCode", [crashUsdt, crashTokenCode]);
  await call("anvil_setCode", [crashRouter, crashRouterCode]);
  await call("anvil_setCode", [crashPortal, crashPortalCode]);
  await Promise.all(
    crashGeniusFactories.map(async (factory) =>
      call("anvil_setCode", [factory, crashGeniusFactoryCode]),
    ),
  );
  const held = pad(toHex(10n ** 30n), { size: 32 });
  await call("anvil_setStorageAt", [crashUsdt, pad(crashRouter, { size: 32 }), held]);
  await call("anvil_setBalance", [crashRouter, toHex(10n ** 24n)]);
  await freshCrashFeeds(call);
}

/**
 * Gives the BNB and USDT feeds a round updated now: the price source refuses one older than its
 * heartbeat plus 30 s, and a run takes longer than the BNB feed's 27 s heartbeat.
 */
export async function freshCrashFeeds(call: AnvilCall): Promise<void> {
  const updatedAtSeconds = BigInt(Math.floor(Date.now() / 1_000));
  const feeds = [
    ["bnb-usd", 600n * 10n ** 8n],
    ["usdt-usd", 10n ** 8n],
  ] as const;
  await Promise.all(
    feeds.map(async ([name, answer]) =>
      call("anvil_setCode", [
        contract("chainlink", name),
        encodeFixtureRound({ answer, updatedAtSeconds }),
      ]),
    ),
  );
}

/** Gives `holder` `base` units of the crash chain's USDT, as a wallet that bought it earlier. */
export async function fundCrashUsdt(call: AnvilCall, holder: Address, base: bigint): Promise<void> {
  const units = pad(toHex(base), { size: 32 });
  await call("anvil_setStorageAt", [crashUsdt, pad(holder, { size: 32 }), units]);
}
