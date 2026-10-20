import type { JsonValue } from "@binference/plugin-sdk";
import { callAbiJson, decodeCall } from "@binference/plugin-sdk/evm";
import { type Address, encodeFunctionData, getAbiItem, type Hex, parseAbi } from "viem";

// The Portal's launch call, as Flap's developer docs declare it ("Launch token through Portal") and
// the verified Portal takes it on BNB Smart Chain (v5.25.0, read 2026-10-20). `newTokenV6` makes a
// token and its curve and, with a `quoteAmt`, runs the first buy for the caller in the same call;
// the call takes no minimum for that buy. Enums travel as `uint8`. The ABI encodes by position, so
// a field's name here need not be the Portal's own.
const launchAbi = parseAbi([
  "struct NewTokenV6Params { string name; string symbol; string meta; uint8 dexThresh; bytes32 salt; uint8 migratorType; address quoteToken; uint256 quoteAmt; address beneficiary; bytes permitData; bytes32 extensionID; bytes extensionData; uint8 dexId; uint8 lpFeeTier; uint16 buyTaxRate; uint16 sellTaxRate; uint64 taxDuration; uint64 antiFarmerDuration; uint16 mktBps; uint16 deflationBps; uint16 dividendBps; uint16 lpBps; uint256 minimumShareBalance; address dividendToken; address commissionReceiver; uint8 tokenVersion; }",
  "function newTokenV6(NewTokenV6Params params) payable returns (address token)",
]);

/** The arguments of a `newTokenV6` call, as the Portal reads them. */
export interface NewTokenArgs {
  readonly name: string;
  readonly symbol: string;
  /** The metadata's IPFS CID, which Flap's upload API answered. */
  readonly meta: string;
  readonly dexThresh: number;
  readonly salt: Hex;
  readonly migratorType: number;
  /** The asset the token trades against; the zero address for the chain's coin. */
  readonly quoteToken: Address;
  /** The first buy's spend in the quote token, in base units; 0 for none. */
  readonly quoteAmt: bigint;
  /** Who receives the tax's marketing share. */
  readonly beneficiary: Address;
  readonly permitData: Hex;
  readonly extensionID: Hex;
  readonly extensionData: Hex;
  readonly dexId: number;
  /** The pool fee tier after migration, which the Portal calls its LP fee profile. */
  readonly lpFeeTier: number;
  readonly buyTaxRate: number;
  readonly sellTaxRate: number;
  /** In seconds. */
  readonly taxDuration: bigint;
  /** In seconds. */
  readonly antiFarmerDuration: bigint;
  readonly mktBps: number;
  readonly deflationBps: number;
  readonly dividendBps: number;
  readonly lpBps: number;
  readonly minimumShareBalance: bigint;
  readonly dividendToken: Address;
  readonly commissionReceiver: Address;
  readonly tokenVersion: number;
}

/** The Portal's `newTokenV6`, the venue's create call, as its JSON ABI. */
export const newTokenFunctionJson: JsonValue = callAbiJson(
  getAbiItem({ abi: launchAbi, name: "newTokenV6" }),
);

/** The calldata of `newTokenV6(args)`. */
export function newTokenCallData(args: NewTokenArgs): Hex {
  return encodeFunctionData({ abi: launchAbi, functionName: "newTokenV6", args: [args] });
}

/**
 * The arguments of a `newTokenV6` call; undefined for any other calldata, and for calldata that is
 * not exactly their encoding, such as one with bytes after them.
 */
export function newTokenArgsOf(data: Hex): NewTokenArgs | undefined {
  const decoded = decodeCall(launchAbi, data);
  const args =
    decoded.ok && decoded.value.functionName === "newTokenV6" ? decoded.value.args[0] : undefined;
  return args !== undefined && newTokenCallData(args) === data.toLowerCase() ? args : undefined;
}
