import type {
  BridgeCall,
  BridgeDeposit,
  CeilingCall,
  CeilingRequest,
  ChainAddresses,
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
  ethereumWeth: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
  robinhoodWeth: "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73",
  /** Saved for Base only: the tests' saved address. */
  baseSaved: "0xeA6F82DbD6C87DE5E542eFbd1f9964879828e4e7",
  /** Saved for Robinhood Chain only. */
  robinhoodSaved: "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed",
  /** The tests' rescue address, plain on BSC and on Ethereum, so a deposit there may pay it. */
  rescue: "0x30435f9D276c6BC54F56161Fb3dFB7bDC2a8DBcB",
  /** Saved for Solana: `4Nd1mBQtrMJVYVfKf2PJy9NZUZdTAsp7D4xWLs4gDB4T`, a wallet, as 32 bytes. */
  solanaSaved: "0x321cfa5add185e8893a5fd88013ec4d7e122ded46354cadff50d956395e75b60",
  /** Never saved: `A9YsiCuAtY5RT3nfLKZTz2EuxxXf3FZogPqHkSH89SXT`, as 32 bytes. */
  solanaUnsaved: "0x87e9de84edd18ed1f059d5b9bb4508d33bec6c014a0a4dac77d72b43dbb315da",
  /** USDC's mint on Solana, `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`, as 32 bytes. */
  solanaUsdc: "0xc6fa7af3bedbad3a3d65f36aabc97431b1bbe4c2d2f6e0e47ca60203452f5d61",
} as const;

/** The id Across gives Solana, which a deposit there names as its destination chain. */
export const solanaBridgeId = "34268394551451";

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

// The tests' `depositTo` on the SpokePool: a 32-byte recipient and token that arrives.
const testSolanaBridgeCall: BridgeCall = {
  ...testBridgeCall,
  abi: bridgeAbis.depositTo,
};

/**
 * Deposits to Base (USDC), Robinhood Chain (ETH to WETH), Ethereum (USDC, and ETH to WETH) and
 * Solana (USDC, through the 32-byte `depositTo`).
 */
export const testDeposits: readonly BridgeDeposit[] = [
  {
    call: testBridgeCall,
    destinationChainId: "8453",
    routes: [{ tokenIn: bridgeAddresses.bscUsdc, tokenOut: bridgeAddresses.baseUsdc }],
  },
  {
    call: testBridgeCall,
    destinationChainId: "4663",
    routes: [{ tokenIn: bridgeAddresses.bscEth, tokenOut: bridgeAddresses.robinhoodWeth }],
  },
  {
    call: testBridgeCall,
    destinationChainId: "1",
    routes: [
      { tokenIn: bridgeAddresses.bscUsdc, tokenOut: bridgeAddresses.ethereumUsdc },
      { tokenIn: bridgeAddresses.bscEth, tokenOut: bridgeAddresses.ethereumWeth },
    ],
  },
  {
    call: testSolanaBridgeCall,
    destinationChainId: solanaBridgeId,
    routes: [{ tokenIn: bridgeAddresses.bscUsdc, tokenOut: bridgeAddresses.solanaUsdc }],
  },
];

/**
 * The addresses saved per destination: one on Base, one on Robinhood Chain, the rescue on Ethereum
 * and one on Solana.
 */
export const testBridged: readonly ChainAddresses[] = [
  { chainId: "8453", addresses: [bridgeAddresses.baseSaved] },
  { chainId: "4663", addresses: [bridgeAddresses.robinhoodSaved] },
  { chainId: "1", addresses: [bridgeAddresses.rescue] },
  { chainId: solanaBridgeId, addresses: [bridgeAddresses.solanaSaved] },
];

/** The approval caps of the tokens the test routes take: BSC's USDC and ETH, 1,000 base units each. */
export const testRouteCaps: ChainCaps["approvals"] = [
  { aggregation: "testcapbscusdc00000000000", limitBase: 1_000n, token: bridgeAddresses.bscUsdc },
  { aggregation: "testcapbsceth000000000000", limitBase: 1_000n, token: bridgeAddresses.bscEth },
];

/**
 * The test ceiling request with the bridge deposits and the addresses saved per destination, each
 * saved for its destination alone, the SpokePool as a spender, and the caps of the routes' tokens
 * after the ones given.
 */
export function testBridgeCeilingRequest(
  caps: ChainCaps = testCaps,
  routeCaps: ChainCaps["approvals"] = testRouteCaps,
): CeilingRequest {
  const request = testCeilingRequest({ ...caps, approvals: [...caps.approvals, ...routeCaps] });
  const chains = request.chains.map((chain) =>
    Object.assign({}, chain, {
      spenders: [...chain.spenders, bridgeAddresses.spokePool],
      bridges: testDeposits,
    }),
  );
  return { ...request, chains, saved: [...request.saved, ...testBridged], bridged: testBridged };
}

/** BSC's staking contracts, the slisBNB token and Relay's depository. */
export const stakingAddresses = {
  stakeHub: "0x0000000000000000000000000000000000002002",
  stakeManager: "0x1adB950d8bB3dA4bE104211D5AB038628e477fE6",
  slisBnb: "0xB0b84D294e0C75A6abe60171b70edEb2EFd14A1B",
  depository: "0x4cD00E387622C35bDDB9b4c962C136462338BC31",
} as const;

// A stake to StakeHub carries up to 100 BNB, as the registry declares (decision 0325).
const stakeCapBase = 100n * 10n ** 18n;

const onContract = (contract: string, names: readonly string[]): readonly CeilingCall[] =>
  names.map((name) => ({
    contract,
    abi: stakingAbis[name] ?? bridgeAbis.register,
    walletInputs: [],
    ...(contract === stakingAddresses.stakeHub && name === "delegate"
      ? { maxValueBase: stakeCapBase }
      : {}),
  }));

// StakeHub's and the stake manager's calls, and the identity registry's `register(string)`.
const testStakingCalls: readonly CeilingCall[] = [
  ...onContract(stakingAddresses.stakeHub, ["delegate", "undelegate", "claim"]),
  ...onContract(stakingAddresses.stakeManager, ["deposit", "requestWithdraw", "claimWithdraw"]),
  { contract: bridgeAddresses.identity, abi: bridgeAbis.register, walletInputs: [] },
];

// Relay's token deposit, paying back the wallet, which only a bridge wallet's ceiling lists.
const testRelayCalls: readonly CeilingCall[] = ["depositErc20"].map((name) => ({
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
  wallet: { readonly kind: "main" | "bridge"; readonly routeCaps?: ChainCaps["approvals"] } = {
    kind: "main",
  },
): CeilingRequest {
  const request = testBridgeCeilingRequest(caps, wallet.routeCaps);
  const relayCalls = wallet.kind === "bridge" ? testRelayCalls : [];
  const relaySpenders = wallet.kind === "bridge" ? [stakingAddresses.depository] : [];
  const chains = request.chains.map((chain) =>
    Object.assign({}, chain, {
      calls: [...chain.calls, ...testStakingCalls, ...relayCalls],
      spenders: [...chain.spenders, stakingAddresses.stakeManager, ...relaySpenders],
    }),
  );
  return { ...request, chains };
}
