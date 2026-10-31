import type { BridgeCall, BridgeTarget, CeilingRequest, ChainCaps } from "../ceiling/ceiling.js";
import { bridgeAbis } from "./bridge-fixtures.js";
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
