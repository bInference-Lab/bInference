import type {
  BridgeCall,
  BridgeTarget,
  CeilingCall,
  CeilingRequest,
  ChainCaps,
} from "../ceiling/ceiling.js";
import { bridgeAbis, stakingAbis } from "./bridge-fixtures.js";
import { testCaps, testCeilingRequest } from "./custody-fixtures.js";

/** Real contracts and tokens on BSC and the destinations, and accounts saved per destination. */
export const bridgeAddresses = {
  spokePool: "0x4e8E101924eDE233C13e2D8622DC8aED2872d505",
  identity: "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432",
  bscUsdc: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d",
  bscEth: "0x2170Ed0880ac9A755fd29B2688956BD959F933F8",
  baseUsdc: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  ethereumUsdc: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
  robinhoodWeth: "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73",
  /** Saved for Base only: the tests' saved address. */
  baseSaved: "0xeA6F82DbD6C87DE5E542eFbd1f9964879828e4e7",
  /** Saved for Robinhood Chain only. */
  robinhoodSaved: "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed",
  /** The tests' rescue address, a plain wallet on BSC and on Ethereum, so a target there lists it. */
  rescue: "0x30435f9D276c6BC54F56161Fb3dFB7bDC2a8DBcB",
} as const;

/** Across's `depositV3` on the SpokePool, binding what Across's plugin declares. */
export const testBridgeCall: BridgeCall = {
  contract: bridgeAddresses.spokePool,
  abi: bridgeAbis.depositV3,
  walletInputs: ["depositor"],
  bridge: {
    recipient: "recipient",
    destinationChain: "destinationChainId",
    tokenIn: "inputToken",
    tokenOut: "outputToken",
  },
};

/** Targets to Base (USDC), Robinhood Chain (ETH to WETH) and Ethereum (USDC, to the rescue address). */
export const testTargets: readonly BridgeTarget[] = [
  {
    call: testBridgeCall,
    destinationChainId: "8453",
    recipients: [bridgeAddresses.baseSaved],
    tokensIn: [bridgeAddresses.bscUsdc],
    tokensOut: [bridgeAddresses.baseUsdc],
  },
  {
    call: testBridgeCall,
    destinationChainId: "4663",
    recipients: [bridgeAddresses.robinhoodSaved],
    tokensIn: [bridgeAddresses.bscEth],
    tokensOut: [bridgeAddresses.robinhoodWeth],
  },
  {
    call: testBridgeCall,
    destinationChainId: "1",
    recipients: [bridgeAddresses.rescue],
    tokensIn: [bridgeAddresses.bscUsdc],
    tokensOut: [bridgeAddresses.ethereumUsdc],
  },
];

/** The test ceiling request with the bridge targets and the SpokePool as a spender beside the router. */
export function testBridgeCeilingRequest(caps: ChainCaps = testCaps): CeilingRequest {
  const request = testCeilingRequest(caps);
  const chains = request.chains.map((chain) =>
    Object.assign({}, chain, {
      spenders: [...chain.spenders, bridgeAddresses.spokePool],
      bridges: testTargets,
    }),
  );
  return { ...request, chains };
}

/** BSC's staking contracts, the slisBNB token and Relay's depository. */
export const stakingAddresses = {
  stakeHub: "0x0000000000000000000000000000000000002002",
  stakeManager: "0x1adB950d8bB3dA4bE104211D5AB038628e477fE6",
  slisBnb: "0xB0b84D294e0C75A6abe60171b70edEb2EFd14A1B",
  depository: "0x4cD00E387622C35bDDB9b4c962C136462338BC31",
} as const;

const onContract = (contract: string, names: readonly string[]): readonly CeilingCall[] =>
  names.map((name) => ({
    contract,
    abi: stakingAbis[name] ?? bridgeAbis.register,
    walletInputs: [],
  }));

// StakeHub's and the stake manager's calls, and the identity registry's `register(string)`.
const testStakingCalls: readonly CeilingCall[] = [
  ...onContract(stakingAddresses.stakeHub, ["delegate", "undelegate", "claim"]),
  ...onContract(stakingAddresses.stakeManager, ["deposit", "requestWithdraw", "claimWithdraw"]),
  { contract: bridgeAddresses.identity, abi: bridgeAbis.register, walletInputs: [] },
];

// Relay's deposits, each paying back the wallet, which only a bridge wallet's ceiling lists.
const testRelayCalls: readonly CeilingCall[] = ["depositErc20", "depositNative"].map((name) => ({
  contract: stakingAddresses.depository,
  abi: stakingAbis[name] ?? bridgeAbis.register,
  walletInputs: ["depositor"],
}));

/**
 * The ceiling of a wallet that bridges, stakes and registers its identity: the bridge request's,
 * with the staking and identity calls and the stake manager as a spender; a bridge wallet's also
 * with Relay's deposits and its depository as a spender (decision 0303).
 */
export function testStakingCeilingRequest(
  caps: ChainCaps = testCaps,
  wallet: "main" | "bridge" = "main",
): CeilingRequest {
  const request = testBridgeCeilingRequest(caps);
  const relayCalls = wallet === "bridge" ? testRelayCalls : [];
  const relaySpenders = wallet === "bridge" ? [stakingAddresses.depository] : [];
  const chains = request.chains.map((chain) =>
    Object.assign({}, chain, {
      calls: [...chain.calls, ...testStakingCalls, ...relayCalls],
      spenders: [...chain.spenders, stakingAddresses.stakeManager, ...relaySpenders],
    }),
  );
  return { ...request, chains };
}
