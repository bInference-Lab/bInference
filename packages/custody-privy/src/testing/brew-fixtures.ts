import { encodeFunctionData, getAbiItem, getAddress, type Hex, parseAbi } from "viem";
import { abiFunctionSchema } from "../ceiling/abi-function.schema.js";
import type { CeilingCall } from "../ceiling/ceiling.js";
import { testAddresses } from "./custody-fixtures.js";

// Brew's create call (decision 0283): BrewFactory's `launch`, one struct with an array of structs
// inside, the first buy paid in the coin as the call's value beyond the fee, which is 0 today.
const brewFactory = parseAbi([
  "struct LiquidityPosition { int24 tickLower; int24 tickUpper; uint16 bps; }",
  "struct LaunchParams { string name; string symbol; string metadataURI; uint256 totalSupply; address quoteToken; uint24 fee; int24 initialTick; LiquidityPosition[] positions; address creatorFeeRecipient; uint256 initialBuyQuoteAmount; uint256 initialBuyMinTokensOut; address initialBuyRecipient; bytes32 salt; uint256 maxLaunchFeeWei; }",
  "function launch(LaunchParams params) payable returns (address token, address pool, uint256[] positionIds)",
]);

/** Brew's `launch` on the tests' router, as a launch wallet's ceiling holds it. */
export const brewCreateCall: CeilingCall = {
  contract: testAddresses.router,
  abi: abiFunctionSchema.parse(getAbiItem({ abi: brewFactory, name: "launch" })),
  walletInputs: [],
};

/** Calldata of Brew's `launch`, with a first buy of `buyWei` in the coin for `recipient`. */
export function brewLaunchData(launch: {
  readonly buyWei: bigint;
  readonly recipient: string;
}): Hex {
  const metadataURI = `data:application/json;base64,${Buffer.from('{"v":1,"image":"data:image/png;base64,iVBORw0KGgo="}').toString("base64")}`;
  return encodeFunctionData({
    abi: brewFactory,
    functionName: "launch",
    args: [
      {
        name: "Custody Brew",
        symbol: "CBREW",
        metadataURI,
        totalSupply: 10n ** 27n,
        quoteToken: getAddress("0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c"),
        fee: 10_000,
        initialTick: -186_600,
        positions: [],
        creatorFeeRecipient: getAddress(testAddresses.rescue),
        initialBuyQuoteAmount: launch.buyWei,
        initialBuyMinTokensOut: 1n,
        initialBuyRecipient: getAddress(launch.recipient),
        salt: `0x${"66".repeat(32)}`,
        maxLaunchFeeWei: 0n,
      },
    ],
  });
}
