import { chainRefSchema, type VenueCall, type VenueContracts } from "@binference/chain";

type Input = readonly [type: string, name: string];

// A function as its JSON ABI entry, with the inputs a ceiling reads by name; no outputs, which
// neither Privy nor the signer reads.
function abiOf(
  name: string,
  inputs: readonly Input[],
  stateMutability: "nonpayable" | "payable" = "nonpayable",
): VenueCall["abi"] {
  return {
    type: "function",
    name,
    inputs: inputs.map(([type, input]) => ({ type, name: input })),
    outputs: [],
    stateMutability,
  };
}

const bsc = chainRefSchema.parse("eip155:56");

// StakeHub, from `bsc-genesis-contract/contracts/StakeHub.sol`: each user function credits
// `msg.sender`, and its credit shares refuse transfer and approval. `redelegate`, `claimBatch` and
// `syncGovToken` are left out: nothing builds them.
const stakehub: VenueContracts = {
  chain: bsc,
  names: ["stake-hub"],
  calls: [
    {
      contract: "stake-hub",
      abi: abiOf(
        "delegate",
        [
          ["address", "operatorAddress"],
          ["bool", "delegateVotePower"],
        ],
        "payable",
      ),
      walletInputs: [],
      // A stake may carry up to 100 BNB, the owner's ruling of 2026-11-01 (decision 0325); every
      // other call keeps the wallet's cap per call.
      maxValueBase: 100n * 10n ** 18n,
    },
    {
      contract: "stake-hub",
      abi: abiOf("undelegate", [
        ["address", "operatorAddress"],
        ["uint256", "shares"],
      ]),
      walletInputs: [],
    },
    {
      contract: "stake-hub",
      abi: abiOf("claim", [
        ["address", "operatorAddress"],
        ["uint256", "requestNumber"],
      ]),
      walletInputs: [],
    },
  ],
};

// Lista's stake manager, from `synclub-contracts/contracts/ListaStakeManager.sol`: `deposit` mints
// slisBNB to `msg.sender`, a withdrawal request is `msg.sender`'s and its claim by the request's own
// id pays it (decision 0332), so a claim names the request its plan names whatever the order of
// the sender's requests. `claimWithdraw` by index, the bot's `claimWithdrawFor` and the
// whitelisted `instantWithdraw` are left out. A stake may carry up to 100 BNB, the owner's ruling
// of 2026-11-02, as StakeHub's does (decisions 0325 and 0332).
const lista: VenueContracts = {
  chain: bsc,
  names: ["stake-manager"],
  calls: [
    {
      contract: "stake-manager",
      abi: abiOf("deposit", [], "payable"),
      walletInputs: [],
      maxValueBase: 100n * 10n ** 18n,
    },
    {
      contract: "stake-manager",
      abi: abiOf("requestWithdraw", [["uint256", "_amountInSlisBnb"]]),
      walletInputs: [],
    },
    {
      contract: "stake-manager",
      abi: abiOf("claimWithdrawByUUID", [["uint256", "_uuid"]]),
      walletInputs: [],
    },
  ],
  spenders: ["stake-manager"],
};

// Across's SpokePool, from `contracts/spoke-pools/SpokePool.sol`: `depositV3` takes 20-byte
// addresses, so a ceiling binds every input that names who gets paid (decision 0302). Its
// 32-byte `deposit`, the periphery's swaps and `speedUpDeposit` are left out.
const across: VenueContracts = {
  chain: bsc,
  names: ["spoke-pool"],
  calls: [
    {
      contract: "spoke-pool",
      abi: abiOf(
        "depositV3",
        [
          ["address", "depositor"],
          ["address", "recipient"],
          ["address", "inputToken"],
          ["address", "outputToken"],
          ["uint256", "inputAmount"],
          ["uint256", "outputAmount"],
          ["uint256", "destinationChainId"],
          ["address", "exclusiveRelayer"],
          ["uint32", "quoteTimestamp"],
          ["uint32", "fillDeadline"],
          ["uint32", "exclusivityParameter"],
          ["bytes", "message"],
        ],
        "payable",
      ),
      walletInputs: ["depositor"],
      bridge: {
        recipient: "recipient",
        destinationChain: "destinationChainId",
        tokenIn: "inputToken",
        tokenOut: "outputToken",
        minOut: "outputAmount",
        amountIn: "inputAmount",
        emptyInputs: ["message"],
      },
    },
  ],
  spenders: ["spoke-pool"],
};

// Relay's depository, from its EVM Depository reference and its verified ABI: a deposit names only
// its depositor and an order id, and the recipient lives in Relay's off-chain order, so only a
// bridge wallet calls it and approves it (decision 0303). Only its token deposit: no route leaves
// as a coin, so no ceiling lets a bridge wallet's gas go into Relay.
const relay: VenueContracts = {
  chain: bsc,
  names: ["depository"],
  calls: [
    {
      contract: "depository",
      abi: abiOf("depositErc20", [
        ["address", "depositor"],
        ["address", "token"],
        ["uint256", "amount"],
        ["bytes32", "id"],
      ]),
      walletInputs: ["depositor"],
      onlyWallet: "bridge",
    },
  ],
  onlyWalletSpenders: { bridge: ["depository"] },
};

// The ERC-8004 identity registry, from its verified `IdentityRegistryUpgradeable.sol`: `register`
// mints to `msg.sender`. Its ERC-721 `approve` shares ERC-20's selector, so no ceiling allows an
// approval sent to it (decision 0304).
const erc8004: VenueContracts = {
  chain: bsc,
  names: ["identity-registry"],
  calls: [
    {
      contract: "identity-registry",
      abi: abiOf("register", [["string", "agentURI"]]),
      walletInputs: [],
    },
  ],
  unapproved: ["identity-registry"],
};

/**
 * The calls binference may make on BSC's staking, bridge and identity contracts, by the venue
 * each belongs to, read from each project's verified source and checked against the code on chain
 * on 2026-10-31. A venue's plugin declares these and no other: a call left out is one no ceiling
 * allows.
 */
export const bscVenueCalls: Readonly<Record<string, VenueContracts>> = {
  stakehub,
  lista,
  across,
  relay,
  erc8004,
};
