import { encodeFunctionData, getAbiItem, getAddress, type Hex, parseAbi, zeroAddress } from "viem";
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

// Genius.fun's create calls (decision 0277): the router's `launchAndBuy` with the Foundation choice,
// which carries a struct with a struct inside, and the factory's `launchToken`; and the router's
// 6-argument `launchAndBuy`, an overload the venue never builds and no ceiling lists.
const geniusParams = [
  "struct Socials { string twitter; string telegram; string discord; string website; string farcaster; }",
  "struct TokenParams { string name; string symbol; string logo; string description; Socials socials; address creatorFeeRecipient; uint16 creatorTaxBps; bool buybackEnabled; bytes32 expectedEconomics; bytes32 salt; }",
] as const;
const geniusRouter = parseAbi([
  ...geniusParams,
  "function launchAndBuy(TokenParams params, uint256 configId, address pairToken, uint256 quoteIn, uint256 minimum, address recipient, bool toFoundation) payable returns (address token, address curve, uint256 tokensOut)",
]);
const geniusFactory = parseAbi([
  ...geniusParams,
  "function launchToken(TokenParams params, uint256 configId, address pairToken, bool toFoundation) payable returns (address token, address curve)",
]);
const geniusUnbuilt = parseAbi([
  ...geniusParams,
  "function launchAndBuy(TokenParams params, uint256 launchConfigId, address pairToken, uint256 quoteIn, uint256 minTokensOut, address recipient) payable returns (address token, address curve, uint256 tokensOut)",
]);

// Genius.fun's two create calls the venue builds, on the tests' router, as a launch wallet's
// ceiling holds them.
const geniusCreateCalls: readonly CeilingCall[] = [
  {
    contract: testAddresses.router,
    abi: abiFunctionSchema.parse(getAbiItem({ abi: geniusRouter, name: "launchAndBuy" })),
    walletInputs: [],
  },
  {
    contract: testAddresses.router,
    abi: abiFunctionSchema.parse(getAbiItem({ abi: geniusFactory, name: "launchToken" })),
    walletInputs: [],
  },
];

/**
 * A request with the create calls added to its first chain's calls, as a launch wallet's has:
 * Flap's `newTokenV6`, and Genius.fun's `launchAndBuy` and `launchToken`.
 */
export function withCreateCall(request: CeilingRequest): CeilingRequest {
  const [first, ...rest] = request.chains;
  const calls = [testCreateCall, ...geniusCreateCalls];
  return first === undefined
    ? request
    : { ...request, chains: [{ ...first, calls: [...first.calls, ...calls] }, ...rest] };
}

// A Genius.fun token's words, picture link and creator terms, as a create call writes them.
function geniusParamsOf(recipient: `0x${string}`) {
  const none = { twitter: "", telegram: "", discord: "", website: "", farcaster: "" };
  return {
    name: "Custody Genius",
    symbol: "CGEN",
    logo: "ipfs://bafkreig7wwicvvvzrbrcgs62ybg7yc7f7ay6s6yhsgpxcxvan5owbcfefm",
    description: "A token for the custody tests",
    socials: { ...none, website: "https://custody.example" },
    creatorFeeRecipient: recipient,
    creatorTaxBps: 0,
    buybackEnabled: true,
    expectedEconomics: `0x${"be".repeat(32)}`,
    salt: `0x${"22".repeat(32)}`,
  } as const;
}

/** A first buy on a Genius.fun create call: what it spends, and who receives it. */
interface GeniusBuy {
  readonly quoteIn: bigint;
  readonly recipient: string;
}

/** Calldata of Genius.fun's `launchAndBuy`, with a first buy of `quoteIn` in the coin. */
export function geniusLaunchAndBuyData(buy: GeniusBuy): Hex {
  return encodeFunctionData({
    abi: geniusRouter,
    functionName: "launchAndBuy",
    args: [
      geniusParamsOf(testAddresses.rescue),
      0n,
      zeroAddress,
      buy.quoteIn,
      1n,
      getAddress(buy.recipient),
      false,
    ],
  });
}

/** Calldata of Genius.fun's `launchToken`, a launch with no first buy. */
export function geniusLaunchTokenData(): Hex {
  return encodeFunctionData({
    abi: geniusFactory,
    functionName: "launchToken",
    args: [geniusParamsOf(testAddresses.rescue), 0n, zeroAddress, false],
  });
}

/** Calldata of the 6-argument `launchAndBuy` overload, which no ceiling lists. */
export function geniusUnbuiltData(buy: GeniusBuy): Hex {
  return encodeFunctionData({
    abi: geniusUnbuilt,
    functionName: "launchAndBuy",
    args: [
      geniusParamsOf(testAddresses.rescue),
      0n,
      zeroAddress,
      buy.quoteIn,
      1n,
      getAddress(buy.recipient),
    ],
  });
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
