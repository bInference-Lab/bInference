import { encodeFixtureRound } from "@binference/chain-evm/fork";
import { bsc } from "@binference/chains";
import { BinferenceError, type JsonValue } from "@binference/core";
import {
  type Address,
  concat,
  getAddress,
  type Hex,
  keccak256,
  numberToHex,
  pad,
  size,
  toHex,
} from "viem";

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

// A small assembler: opcodes as bytes, pushes of a fixed width, jump targets and their labels.
type Item =
  | Hex
  | { readonly push: number; readonly value: bigint }
  | { readonly mark: string }
  | { readonly to: string };

const p = (bytes: number, value: bigint): Item => ({ push: bytes, value });

function sizeOf(item: Item): number {
  if (typeof item === "string") {
    return size(item);
  }
  if ("push" in item) {
    return 1 + item.push;
  }
  return "mark" in item ? 1 : 3;
}

function pushed(bytes: number, value: bigint): Hex {
  return concat([numberToHex(0x5f + bytes, { size: 1 }), numberToHex(value, { size: bytes })]);
}

function assemble(items: readonly Item[]): Hex {
  const marks = new Map<string, number>();
  items.reduce((offset, item) => {
    if (typeof item !== "string" && "mark" in item) {
      marks.set(item.mark, offset);
    }
    return offset + sizeOf(item);
  }, 0);
  return concat(
    items.map((item): Hex => {
      if (typeof item === "string") {
        return item;
      }
      if ("push" in item) {
        return pushed(item.push, item.value);
      }
      return "mark" in item ? "0x5b" : pushed(2, BigInt(marks.get(item.to) ?? 0));
    }),
  );
}

const op = {
  add: "0x01",
  mul: "0x02",
  sub: "0x03",
  lt: "0x10",
  eq: "0x14",
  isZero: "0x15",
  shl: "0x1b",
  shr: "0x1c",
  caller: "0x33",
  callValue: "0x34",
  callDataLoad: "0x35",
  mstore: "0x52",
  sload: "0x54",
  sstore: "0x55",
  jumpI: "0x57",
  gas: "0x5a",
  dup1: "0x80",
  dup2: "0x81",
  dup3: "0x82",
  swap1: "0x90",
  log3: "0xa3",
  call: "0xf1",
  stop: "0x00",
  return: "0xf3",
  revert: "0xfd",
} as const satisfies Record<string, Hex>;

const transferTopic = BigInt(keccak256(toHex("Transfer(address,address,uint256)")));
const returnWord: readonly Item[] = [p(1, 0n), op.mstore, p(1, 32n), p(1, 0n), op.return];
const fail: readonly Item[] = [{ mark: "fail" }, p(1, 0n), op.dup1, op.revert];

// transfer(to, amount): moves the caller's units, logs Transfer, answers true.
const transfer: readonly Item[] = [
  { mark: "transfer" },
  p(1, 0x24n),
  op.callDataLoad,
  op.caller,
  op.sload,
  op.dup2,
  op.dup2,
  op.lt,
  { to: "fail" },
  op.jumpI,
  op.dup2,
  op.swap1,
  op.sub,
  op.caller,
  op.sstore,
  p(1, 4n),
  op.callDataLoad,
  op.dup1,
  op.sload,
  op.dup3,
  op.add,
  op.swap1,
  op.sstore,
  p(1, 0n),
  op.mstore,
  p(1, 4n),
  op.callDataLoad,
  op.caller,
  p(32, transferTopic),
  p(1, 32n),
  p(1, 0n),
  op.log3,
  p(1, 1n),
  ...returnWord,
];

/**
 * The runtime code of the crash chain's USDT: an ERC-20 with only `balanceOf` and `transfer`,
 * each holder's units in the storage slot of its own address, and a Transfer log per transfer, as
 * the simulator's transfer traces read them.
 */
const crashTokenCode: Hex = assemble([
  p(1, 0n),
  op.callDataLoad,
  p(1, 0xe0n),
  op.shr,
  op.dup1,
  p(4, 0x70a08231n),
  op.eq,
  { to: "balanceOf" },
  op.jumpI,
  p(4, 0xa9059cbbn),
  op.eq,
  { to: "transfer" },
  op.jumpI,
  p(1, 0n),
  op.dup1,
  op.revert,
  { mark: "balanceOf" },
  p(1, 4n),
  op.callDataLoad,
  op.sload,
  ...returnWord,
  ...transfer,
  ...fail,
]);

/**
 * The runtime code of the crash chain's swap router: any call pays its caller {@link usdtPerWei}
 * USDT units for each wei it sent, from the router's own USDT, and reverts when that transfer
 * fails.
 */
const crashRouterCode: Hex = assemble([
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
  ...fail,
]);

/**
 * Sets up the market a crash run trades in on a bare chain: USDT and KyberSwap's router at their
 * BSC addresses, the router holding USDT to pay out, and fresh rounds of the BNB and USDT feeds.
 */
export async function installCrashMarket(call: AnvilCall): Promise<void> {
  await call("anvil_setCode", [crashUsdt, crashTokenCode]);
  await call("anvil_setCode", [crashRouter, crashRouterCode]);
  const held = pad(toHex(10n ** 30n), { size: 32 });
  await call("anvil_setStorageAt", [crashUsdt, pad(crashRouter, { size: 32 }), held]);
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
