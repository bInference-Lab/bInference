import { bscContract, type Fork } from "@binference/chain-evm/fork";
import { BinferenceError } from "@binference/core";
import { type Address, encodeFunctionData, type Hex, pad, parseAbi, zeroAddress } from "viem";

// Flap's Portal, through which the fork's own account launches a tax token against BNB with its
// first buy, as Flap's `newTokenV6` takes it: a 1% tax each way, all of it to the marketing
// wallet, and the token's address from the salt, which must end in 7777 for a tax token.
const portal = bscContract("flap", "portal");
const portalAbi = parseAbi([
  "struct NewTokenV6Params { string name; string symbol; string meta; uint8 dexThresh; bytes32 salt; uint8 migratorType; address quoteToken; uint256 quoteAmt; address beneficiary; bytes permitData; bytes32 extensionID; bytes extensionData; uint8 dexId; uint8 lpFeeProfile; uint16 buyTaxRate; uint16 sellTaxRate; uint64 taxDuration; uint64 antiFarmerDuration; uint16 mktBps; uint16 deflationBps; uint16 dividendBps; uint16 lpBps; uint256 minimumShareBalance; address dividendToken; address commissionReceiver; uint8 tokenVersion; }",
  "function newTokenV6(NewTokenV6Params params) payable returns (address token)",
]);
// A launch makes the token, its curve and a pool; it takes about 5.6 million gas.
const launchGas = 15_000_000n;

/**
 * Salts whose tokens no one launched on BSC, each giving a Flap tax token's address (ending in
 * 7777) from the Portal, found once off line: a launch with one makes `token`.
 */
export const flapSalts: readonly { readonly salt: Hex; readonly token: Address }[] = [
  {
    salt: "0xfa46d944e827c386aa1f9207cbd6e50a331ca1d51228261ac83939d2a0119f0a",
    token: "0x01D47b3fDF1E9CaA63c69c6F0B08449a89417777",
  },
  {
    salt: "0xfa46d944e827c386aa1f9207cbd6e50a331ca1d51228261ac83939d2a0130f36",
    token: "0x3227c9CeB086e2f398e4703D30aDa5C779137777",
  },
];

/**
 * Launches a Flap tax token against BNB from the fork's own account with one of {@link flapSalts}
 * and a first buy of `firstBuy` wei, and answers its token.
 */
export async function launchOnFlap(
  fork: Fork,
  launch: { readonly salt: Hex; readonly token: Address; readonly firstBuy: bigint },
): Promise<Address> {
  const params = {
    name: "Feed Fork",
    symbol: "FEED",
    meta: "bafkreibxo4udedy3sxsljj7bmrvs7aodggcj6n4m5xaxb5xtydv3fwruem",
    dexThresh: 1,
    salt: launch.salt,
    migratorType: 1,
    quoteToken: zeroAddress,
    quoteAmt: launch.firstBuy,
    beneficiary: fork.account,
    permitData: "0x",
    extensionID: pad("0x", { size: 32 }),
    extensionData: "0x",
    dexId: 0,
    lpFeeProfile: 0,
    buyTaxRate: 100,
    sellTaxRate: 100,
    taxDuration: 3_153_600_000n,
    antiFarmerDuration: 2_592_000n,
    mktBps: 10_000,
    deflationBps: 0,
    dividendBps: 0,
    lpBps: 0,
    minimumShareBalance: 0n,
    dividendToken: zeroAddress,
    commissionReceiver: zeroAddress,
    tokenVersion: 6,
  } as const;
  const data = encodeFunctionData({ abi: portalAbi, functionName: "newTokenV6", args: [params] });
  const receipt = await fork.send({
    from: fork.account,
    to: portal,
    value: launch.firstBuy,
    data,
    gas: launchGas,
  });
  if (receipt.status !== "success") {
    throw new BinferenceError({
      code: "fork.no_launch",
      message: "Flap's Portal refused the launch.",
    });
  }
  return launch.token;
}
