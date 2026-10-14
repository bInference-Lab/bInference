import { bscContract, type Fork } from "@binference/chain-evm/fork";
import { BinferenceError } from "@binference/core";
import { type Address, encodeFunctionData, type Hex, parseAbi, toHex, zeroAddress } from "viem";

// Genius.fun's m4.2 factory, through which the fork's own account launches a token.
const factory = bscContract("geniusfun", "factory-m4-2");
const factoryAbi = parseAbi([
  "struct Socials { string twitter; string telegram; string discord; string website; string farcaster; }",
  "struct TokenParams { string name; string symbol; string logo; string description; Socials socials; address creatorFeeRecipient; uint16 creatorTaxBps; bool buybackEnabled; bytes32 expectedEconomics; bytes32 salt; }",
  "function launchToken(TokenParams params, uint256 configId, address pairToken, bool toFoundation, address[] snipeTaxExemptions) payable returns (address token, address curve)",
  "function previewLaunchEconomics(uint256 launchConfigId, address pairToken) view returns (bytes32)",
  "function launchFee() view returns (uint256)",
  "event TokenLaunched(address indexed token, address indexed curve, address indexed deployer, address pairToken, uint256 launchConfigId, uint256 graduationThreshold)",
]);
// A launch taxes buys in its first seconds; past this many, a buy pays no snipe tax.
const launchWindowSeconds = 16;

/** A token launched on the fork, and the curve of its own launch. */
export interface ForkLaunch {
  readonly token: Address;
  readonly curve: Address;
}

// The terms of a launch with no creator tax, against the economics the factory quotes.
function termsOf(economics: Hex) {
  const socials = { twitter: "", telegram: "", discord: "", website: "", farcaster: "" };
  return {
    name: "Launch Wallet Fork",
    symbol: "LWF",
    logo: "",
    description: "",
    socials,
    creatorFeeRecipient: zeroAddress,
    creatorTaxBps: 0,
    buybackEnabled: true,
    expectedEconomics: economics,
    salt: toHex(BigInt(Date.now()), { size: 32 }),
  };
}

/**
 * Launches a token against BNB on Genius.fun's m4.2 stack from the fork's own account, exempting
 * no wallet, and lets the launch's window pass so a buy pays no snipe tax: a token on a curve no
 * list holds, as every new launch is.
 */
export async function launchOnGeniusfun(fork: Fork): Promise<ForkLaunch> {
  const [fee, economics] = await Promise.all([
    fork.client.readContract({ address: factory, abi: factoryAbi, functionName: "launchFee" }),
    fork.client.readContract({
      address: factory,
      abi: factoryAbi,
      functionName: "previewLaunchEconomics",
      args: [0n, zeroAddress],
    }),
  ]);
  const args = [termsOf(economics), 0n, zeroAddress, false, []] as const;
  const data = encodeFunctionData({ abi: factoryAbi, functionName: "launchToken", args });
  const receipt = await fork.send({ from: fork.account, to: factory, value: fee, data });
  const [event] = await fork.client.getContractEvents({
    address: factory,
    abi: factoryAbi,
    eventName: "TokenLaunched",
    blockHash: receipt.blockHash,
  });
  const { token, curve } = event?.args ?? {};
  if (receipt.status !== "success" || token === undefined || curve === undefined) {
    throw new BinferenceError({ code: "fork.no_launch", message: "The launch named no token." });
  }
  await fork.call("evm_increaseTime", [launchWindowSeconds]);
  await fork.call("evm_mine", []);
  return { token, curve };
}
