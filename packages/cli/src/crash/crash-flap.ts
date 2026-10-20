import type { JsonValue } from "@binference/core";
import {
  type Address,
  concat,
  type Hex,
  keccak256,
  padHex,
  slice,
  toFunctionSelector,
  toHex,
} from "viem";
import { assemble, fail, type Item, op, p, pullFromCaller } from "./crash-assembler.js";
import { crashContract } from "./crash-market.js";
import { crashTokenCodeOf } from "./crash-token.js";

/** Calls anvil itself, past the test's counting and kills. */
type AnvilCall = (method: string, params: readonly JsonValue[]) => Promise<JsonValue>;

/** Flap's Portal, which launches a crash token and which a buy or sale asks about its token. */
const crashPortal: Address = crashContract("flap", "portal");
/** The Tax Token V3 implementation, whose minimal proxies a launch makes. */
const crashTaxToken: Address = crashContract("flap", "tax-token-v3-implementation");

/** The new token's base units a crash launch's first buy gets for each base unit it spends. */
export const launchTokensPerUnit = 1_000n;

// The selector of Flap's `TokenNotFound(address)`, the Portal's revert for a token it never made.
const tokenNotFound = BigInt(keccak256(toHex("TokenNotFound(address)")).slice(0, 10));
// The Portal's `newTokenV6`, by its parameters' types as Flap's docs declare them.
const newTokenV6 = BigInt(
  toFunctionSelector(
    "newTokenV6((string,string,string,uint8,bytes32,uint8,address,uint256,address,bytes,bytes32,bytes,uint8,uint8,uint16,uint16,uint64,uint64,uint16,uint16,uint16,uint16,uint256,address,address,uint8))",
  ),
);
const topicOf = (event: string): Item => p(32, BigInt(keccak256(toHex(event))));

// `newTokenV6`'s one argument is a tuple with strings, so it starts at 0x24, after the selector and
// its offset; field `i` of its head is the word at 0x24 + 32 * i.
const field = (index: number): readonly Item[] => [
  p(2, BigInt(0x24 + 32 * index)),
  op.callDataLoad,
];
const name = field(0);
const symbol = field(1);
const meta = field(2);
const salt = field(4);
const quoteToken = field(6);
const quoteAmt = field(7);
const permitData = field(9);
const buyTax = field(14);
const sellTax = field(15);

// Where the launch keeps its values in memory, apart from the call and log data it writes at 0.
const tokenAt = p(2, 0x1000n);
const boughtAt = p(2, 0x1020n);

// The creation code of the token's minimal proxy (EIP-1167) of the implementation, as two words
// in memory at 0: 55 bytes, as the Portal makes each token.
const proxyCode = padHex(
  concat([
    "0x3d602d80600a3d3981f3363d3d373d3d3d363d73",
    crashTaxToken,
    "0x5af43d82803e903d91602b57fd5bf3",
  ]),
  { dir: "right", size: 64 },
);

// The first buy's spend reaches the Portal: the coin as the call's value, or the quote token by
// `transferFrom` of the caller's allowance; any other value fails.
const takeFirstBuy: readonly Item[] = [
  ...quoteToken,
  op.isZero,
  { to: "coin" },
  op.jumpI,
  op.callValue,
  { to: "fail" },
  op.jumpI,
  ...pullFromCaller(quoteToken, quoteAmt),
  { to: "made" },
  op.jump,
  { mark: "coin" },
  op.callValue,
  ...quoteAmt,
  op.eq,
  op.isZero,
  { to: "fail" },
  op.jumpI,
  { mark: "made" },
];

// The token's proxy at the CREATE2 address of the salt, then its first buy minted to the caller.
const makeToken: readonly Item[] = [
  p(32, BigInt(slice(proxyCode, 0, 32))),
  p(1, 0n),
  op.mstore,
  p(32, BigInt(slice(proxyCode, 32, 64))),
  p(1, 0x20n),
  op.mstore,
  ...salt,
  p(1, 55n),
  p(1, 0n),
  p(1, 0n),
  op.create2,
  op.dup1,
  op.isZero,
  { to: "fail" },
  op.jumpI,
  tokenAt,
  op.mstore,
  ...quoteAmt,
  p(2, launchTokensPerUnit),
  op.mul,
  boughtAt,
  op.mstore,
  p(4, 0x40c10f19n),
  p(1, 0xe0n),
  op.shl,
  p(1, 0n),
  op.mstore,
  op.caller,
  p(1, 4n),
  op.mstore,
  boughtAt,
  op.mload,
  p(1, 0x24n),
  op.mstore,
  p(1, 0n),
  p(1, 0n),
  p(1, 0x44n),
  p(1, 0n),
  p(1, 0n),
  tokenAt,
  op.mload,
  op.gas,
  op.call,
  op.isZero,
  { to: "fail" },
  op.jumpI,
];

// `TokenCreated(ts, creator, nonce, token, name, symbol, meta)`: its seven heads, then the call's
// own tails of the three strings, which the encoder wrote one after another before `permitData`.
const tokenCreated: readonly Item[] = [
  op.timestamp,
  p(1, 0n),
  op.mstore,
  op.caller,
  p(1, 0x20n),
  op.mstore,
  p(1, 0n),
  p(1, 0x40n),
  op.mstore,
  tokenAt,
  op.mload,
  p(1, 0x60n),
  op.mstore,
  p(1, 0xe0n),
  p(1, 0x80n),
  op.mstore,
  ...name,
  ...symbol,
  p(1, 0xe0n),
  op.add,
  op.sub,
  p(1, 0xa0n),
  op.mstore,
  ...name,
  ...meta,
  p(1, 0xe0n),
  op.add,
  op.sub,
  p(1, 0xc0n),
  op.mstore,
  ...name,
  ...permitData,
  op.sub,
  ...name,
  p(1, 0x24n),
  op.add,
  p(1, 0xe0n),
  op.callDataCopy,
  topicOf("TokenCreated(uint256,address,uint256,address,string,string,string)"),
  ...name,
  ...permitData,
  op.sub,
  p(1, 0xe0n),
  op.add,
  p(1, 0n),
  op.log1,
];

// `TokenQuoteSet(token, quoteToken)`, `FlapTokenTaxSet(token, the higher tax)` and
// `TokenBought(ts, token, buyer, amount, eth, fee, postPrice)`, then the token as the answer.
const otherEvents: readonly Item[] = [
  tokenAt,
  op.mload,
  p(1, 0n),
  op.mstore,
  ...quoteToken,
  p(1, 0x20n),
  op.mstore,
  topicOf("TokenQuoteSet(address,address)"),
  p(1, 0x40n),
  p(1, 0n),
  op.log1,
  ...buyTax,
  p(1, 0x20n),
  op.mstore,
  ...sellTax,
  ...buyTax,
  op.lt,
  op.isZero,
  { to: "taxed" },
  op.jumpI,
  ...sellTax,
  p(1, 0x20n),
  op.mstore,
  { mark: "taxed" },
  topicOf("FlapTokenTaxSet(address,uint256)"),
  p(1, 0x40n),
  p(1, 0n),
  op.log1,
  op.timestamp,
  p(1, 0n),
  op.mstore,
  tokenAt,
  op.mload,
  p(1, 0x20n),
  op.mstore,
  op.caller,
  p(1, 0x40n),
  op.mstore,
  boughtAt,
  op.mload,
  p(1, 0x60n),
  op.mstore,
  ...quoteAmt,
  p(1, 0x80n),
  op.mstore,
  p(1, 0n),
  p(1, 0xa0n),
  op.mstore,
  p(1, 0n),
  p(1, 0xc0n),
  op.mstore,
  topicOf("TokenBought(uint256,address,address,uint256,uint256,uint256,uint256)"),
  p(1, 0xe0n),
  p(1, 0n),
  op.log1,
  tokenAt,
  op.mload,
  p(1, 0n),
  op.mstore,
  p(1, 0x20n),
  p(1, 0n),
  op.return,
];

/**
 * The runtime code of the crash chain's Flap Portal. `newTokenV6` launches as the Portal does for
 * what the engine reads of it: it takes the first buy's spend, makes the token as a minimal proxy
 * of the Tax Token V3 implementation at the CREATE2 address of the call's salt, pays the caller
 * {@link launchTokensPerUnit} of the token for each unit spent, logs the Portal's launch events
 * and answers the token. It runs no curve: every other call reverts with `TokenNotFound` and the
 * address its first argument names, as the Portal answers for a token Flap never launched.
 */
const crashPortalCode: Hex = assemble([
  p(1, 0n),
  op.callDataLoad,
  p(1, 0xe0n),
  op.shr,
  p(4, newTokenV6),
  op.eq,
  { to: "launch" },
  op.jumpI,
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
  { mark: "launch" },
  ...takeFirstBuy,
  ...makeToken,
  ...tokenCreated,
  ...otherEvents,
  ...fail,
]);

/**
 * Sets up Flap on the crash chain: its Portal, and the token implementation whose `mint` only the
 * Portal may call, at their BSC addresses.
 */
export async function installCrashFlap(call: AnvilCall): Promise<void> {
  await call("anvil_setCode", [crashPortal, crashPortalCode]);
  await call("anvil_setCode", [crashTaxToken, crashTokenCodeOf(crashPortal)]);
}
