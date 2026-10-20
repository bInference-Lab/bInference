import { encodeFunctionData, getAbiItem, type Hex, parseAbi, zeroAddress } from "viem";
import { abiFunctionSchema } from "../ceiling/abi-function.schema.js";
import type { CeilingCall, CeilingRequest } from "../ceiling/ceiling.js";
import type { AbiFunction } from "../ceiling/policy-rule.js";
import { testAddresses } from "./custody-fixtures.js";

// A launchpad's create call with the shape of Flap's `newTokenV6` (decision 0271): one struct of
// 26 fields, the first buy paid as the call's value, and the token paid to the caller.
const launchpad = parseAbi([
  "struct NewTokenV6Params { string name; string symbol; string meta; uint8 dexThresh; bytes32 salt; uint8 migratorType; address quoteToken; uint256 quoteAmt; address beneficiary; bytes permitData; bytes32 extensionID; bytes extensionData; uint8 dexId; uint8 lpFeeTier; uint16 buyTaxRate; uint16 sellTaxRate; uint64 taxDuration; uint64 antiFarmerDuration; uint16 mktBps; uint16 deflationBps; uint16 dividendBps; uint16 lpBps; uint256 minimumShareBalance; address dividendToken; address commissionReceiver; uint8 tokenVersion; }",
  "function newTokenV6(NewTokenV6Params params) payable returns (address token)",
]);

// The create call's function as a ceiling holds it: a JSON ABI entry.
const testCreateAbi: AbiFunction = abiFunctionSchema.parse(
  getAbiItem({ abi: launchpad, name: "newTokenV6" }),
);

// The create call on the tests' router, which only a launch wallet's ceiling allows.
const testCreateCall: CeilingCall = {
  contract: testAddresses.router,
  abi: testCreateAbi,
  walletInputs: [],
};

/** A request with the create call added to its first chain's calls, as a launch wallet's has. */
export function withCreateCall(request: CeilingRequest): CeilingRequest {
  const [first, ...rest] = request.chains;
  return first === undefined
    ? request
    : { ...request, chains: [{ ...first, calls: [...first.calls, testCreateCall] }, ...rest] };
}

/** Calldata of a create call that spends `quoteAmt` of the coin on its first buy. */
export function createData(quoteAmt: bigint): Hex {
  const params = {
    name: "Custody Cat",
    symbol: "CCAT",
    meta: "bafkreibxo4udedy3sxsljj7bmrvs7aodggcj6n4m5xaxb5xtydv3fwruem",
    dexThresh: 1,
    salt: `0x${"11".repeat(32)}`,
    migratorType: 1,
    quoteToken: zeroAddress,
    quoteAmt,
    beneficiary: zeroAddress,
    permitData: "0x",
    extensionID: `0x${"00".repeat(32)}`,
    extensionData: "0x",
    dexId: 0,
    lpFeeTier: 0,
    buyTaxRate: 300,
    sellTaxRate: 300,
    taxDuration: 31_536_000n,
    antiFarmerDuration: 0n,
    mktBps: 10_000,
    deflationBps: 0,
    dividendBps: 0,
    lpBps: 0,
    minimumShareBalance: 0n,
    dividendToken: zeroAddress,
    commissionReceiver: zeroAddress,
    tokenVersion: 6,
  } as const;
  return encodeFunctionData({ abi: launchpad, functionName: "newTokenV6", args: [params] });
}
