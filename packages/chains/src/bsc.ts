import type { ChainDefinition, ContractDefinition, TokenDefinition } from "@binference/chain";
import type { PriceFeedDefinition } from "./feeds/price-feed-definition.js";

// Every address here was read on chain on this day: its code, proxy slots and owner, and a call
// that ties it to its siblings. KyberSwap's router is the one exception and says so.
const checkedOn = "2026-10-06";

type TokenRow = readonly [symbol: string, name: string, decimals: number, address: string];

type AddressesBySource = Readonly<Record<string, Readonly<Record<string, string>>>>;

function createTokens(
  rowsBySource: Readonly<Record<string, readonly TokenRow[]>>,
): TokenDefinition[] {
  return Object.entries(rowsBySource).flatMap(([source, rows]) =>
    rows.map(([symbol, name, decimals, address]): TokenDefinition => ({
      symbol,
      name,
      decimals,
      address,
      verification: { source, checkedOn, control: "read" },
    })),
  );
}

function createContracts(venue: string, sources: AddressesBySource): ContractDefinition[] {
  return Object.entries(sources).flatMap(([source, addresses]) =>
    Object.entries(addresses).map(([name, address]): ContractDefinition => ({
      venue,
      name,
      address,
      verification: { source, checkedOn, control: "read" },
    })),
  );
}

// Stablecoins on BSC have 18 decimals, not the 6 they have elsewhere.
const tokens = createTokens({
  "https://www.binance.com/bapi/capital/v1/public/capital/getNetworkCoinAll": [
    ["WBNB", "Wrapped BNB", 18, "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c"],
    ["USDT", "Tether USD", 18, "0x55d398326f99059fF775485246999027B3197955"],
    ["USDC", "USD Coin", 18, "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d"],
    ["FDUSD", "First Digital USD", 18, "0xc5f0f7b66764F6ec8C8Dff7BA683102295E16409"],
    ["BTCB", "BTCB Token", 18, "0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c"],
    ["ETH", "Ethereum Token", 18, "0x2170Ed0880ac9A755fd29B2688956BD959F933F8"],
    ["Cake", "PancakeSwap Token", 18, "0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82"],
  ],
  "https://docs.bsc.lista.org/for-developer/liquid-staking-slisbnb/smart-contract": [
    ["slisBNB", "Staked Lista BNB", 18, "0xB0b84D294e0C75A6abe60171b70edEb2EFd14A1B"],
  ],
});

// PancakeSwap's Universal Routers take approvals through PancakeSwap's own Permit2, not Uniswap's.
const pancakeswap = createContracts("pancakeswap", {
  "https://developer.pancakeswap.finance/contracts/v2/addresses": {
    "v2-factory": "0xcA143Ce32Fe78f1f7019d7d551a6402fC5350c73",
    "v2-router": "0x10ED43C718714eb63d5aA57B78B54704E256024E",
  },
  "https://developer.pancakeswap.finance/contracts/v3/addresses": {
    "v3-factory": "0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865",
    "v3-pool-deployer": "0x41ff9AA7e16B8B1a8a8dc4f0eFacd93D02d071c9",
    "v3-swap-router": "0x1b81D678ffb9C0263b24A97847620C99d213eB14",
    "v3-quoter-v2": "0xB048Bbc1Ee6b733FFfCFb9e9CeF7375518e25997",
    "v3-position-manager": "0x46A15B0b27311cedF172AB29E4f4766fbE7F4364",
    "mixed-route-quoter-v1": "0x678Aa4bF4E210cf2166753e054d5b7c31cc7fa86",
    "smart-router": "0x13f4EA83D0bd40E75C8222255bc855a974568Dd4",
  },
  "https://developer.pancakeswap.finance/contracts/universal-router/addresses": {
    "infinity-universal-router": "0xd9C500DfF816a1Da21A48A732d3498Bf09dc9AEB",
    "v3-universal-router": "0x1A0A18AC4BECDDbd6389559687d1A73d8927E416",
  },
  "https://developer.pancakeswap.finance/contracts/permit2/addresses": {
    permit2: "0x31c2F6fcFf4F8759b3Bd5Bf0e1084A055615c768",
  },
  "https://developer.pancakeswap.finance/contracts/infinity/resources/addresses": {
    "infinity-vault": "0x238a358808379702088667322f80aC48bAd5e6c4",
    "infinity-cl-pool-manager": "0xa0FfB9c1CE1Fe56963B0321B32E7A0302114058b",
    "infinity-bin-pool-manager": "0xC697d2898e0D09264376196696c51D7aBbbAA4a9",
    "infinity-cl-quoter": "0xd0737C9762912dD34c3271197E362Aa736Df0926",
    "infinity-bin-quoter": "0xC631f4B0Fc2Dd68AD45f74B2942628db117dD359",
    "infinity-mixed-quoter": "0x2dCbF7B985c8C5C931818e4E107bAe8aaC8dAB7C",
  },
});

// The router's code was read on chain; its proxy slots and owner were not.
const kyberswapRouter: ContractDefinition = {
  venue: "kyberswap",
  name: "meta-aggregation-router-v2",
  address: "0x6131B5fae19EA4f9D964eAc0408E4408b66337b5",
  verification: {
    source: "https://docs.kyberswap.com/developer-guide/aggregator-api/contracts",
    checkedOn,
    control: "not_read",
  },
};

const fourmeme = createContracts("fourmeme", {
  "https://github.com/four-meme-community/fourmeme-docs/blob/main/docs/integration-guide.md": {
    "token-manager-v1": "0xEC4549caDcE5DA21Df6E6422d448034B5233bFbC",
    "token-manager-2": "0x5c952063c7fc8610FFDB798152D69F0B9550762b",
    "token-manager-helper-3": "0xF251F83e40a78868FcfA3FA4599Dad6494E46034",
  },
  "https://github.com/four-meme-community/four-meme-ai/blob/main/skills/four-meme-integration/references/contract-addresses.md":
    { "agent-identifier": "0x09B44A633de9F9EBF6FB9Bdd5b5629d3DD2cef13" },
});

const flap = createContracts("flap", {
  "https://docs.flap.sh/flap/developers/deployed-contract-addresses": {
    portal: "0xe2cE6ab80874Fa9Fa2aAE65D277Dd6B8e65C9De0",
    "vault-portal": "0x90497450f2a706f1951b5bdda52B4E5d16f34C06",
    "tax-token-helper": "0x53841c73217735F37BC1775538b03b23feFD8346",
    "tax-token-v3-implementation": "0x024f18294970B5c76c0691b87f138A0317156422",
    "standard-token-v3-implementation": "0x88881b6f03090462a969eC7f48385744Eeb63333",
    "standard-token-implementation": "0x8B4329947e34B6d56D71A3385caC122BaDe7d78D",
  },
});

const venus = createContracts("venus", {
  "https://github.com/VenusProtocol/venus-protocol/blob/main/deployments/bscmainnet_addresses.json":
    {
      unitroller: "0xfD36E2c2a6789Db23113685031d7F16329158384",
      vbnb: "0xA07c5b74C9B40447a954e1466938b865b6BBea36",
      vusdt: "0xfD5840Cd36d94D7229439859C0112a4185BC0255",
      vusdc: "0xecA88125a5ADbe82614ffC12D0DB554E2e2867C8",
      vbtc: "0x882C173bC7Ff3b7786CA16dfeD3DFFfb9Ee7847B",
      veth: "0xf508fCD89b8bd15579dc79A6827cB4686A3592c8",
    },
});

const lista = createContracts("lista", {
  "https://docs.bsc.lista.org/for-developer/liquid-staking-slisbnb/smart-contract": {
    "stake-manager": "0x1adB950d8bB3dA4bE104211D5AB038628e477fE6",
  },
  "https://docs.bsc.lista.org/for-developer/lista-lending/smart-contract/smart-contract-bsc-core": {
    moolah: "0x8F73b65B4caAf64FBA2aF91cC5D4a2A1318E5D8C",
    "moolah-vault-wbnb": "0x57134a64B7cD9F9eb72F8255A671F5Bf2fe3E2d0",
    "moolah-vault-usdt": "0x6d6783C146F2B0B2774C1725297f1845dc502525",
  },
});

const aave = createContracts("aave", {
  "https://github.com/bgd-labs/aave-address-book/blob/main/src/AaveV3BNB.sol": {
    "pool-addresses-provider": "0xff75B6da14FfbbfD355Daf7a2731456b3562Ba6D",
    pool: "0x6807dc923806fE8Fd134338EABCA509979a7e0cB",
    oracle: "0x39bc1bfDa2130d6Bb6DBEfd366939b4c7aa7C697",
    "pool-data-provider": "0xc90Df74A7c16245c5F5C5870327Ceb38Fe5d5328",
    "wrapped-token-gateway": "0x0c2C95b24529664fE55D4437D7A31175CFE6c4f7",
  },
});

const stakehub = createContracts("stakehub", {
  "https://github.com/bnb-chain/bsc-genesis-contract/blob/master/contracts/System.sol": {
    "stake-hub": "0x0000000000000000000000000000000000002002",
  },
});

// Across's periphery takes approvals through Uniswap's Permit2, not PancakeSwap's.
const across = createContracts("across", {
  "https://github.com/across-protocol/contracts/blob/master/broadcast/deployed-addresses.json": {
    "spoke-pool": "0x4e8E101924eDE233C13e2D8622DC8aED2872d505",
    "spoke-pool-periphery": "0x97CCDBea4632140639aD5eA9b944aa034eb15fD4",
    "multicall-handler": "0x0F7Ae28dE1C8532170AD4ee566B5801485c13a0E",
  },
  "https://docs.uniswap.org/contracts/v4/deployments": {
    permit2: "0x000000000022D473030F116dDEE9F6B43aC78BA3",
  },
});

const relay = createContracts("relay", {
  "https://api.relay.link/chains": {
    receiver: "0xa5F565650890fBA1824Ee0F21EbBbF660a179934",
    "erc20-router": "0xb92fe925DC43a0ECdE6c8b1a2709c170Ec4fFf4f",
    "approval-proxy": "0xCcC88a9d1B4ED6b0EABA998850414b24f1c315bE",
  },
  "https://docs.relay.link/references/protocol/addresses": {
    depository: "0x4cD00E387622C35bDDB9b4c962C136462338BC31",
  },
});

// Feed proxies only: the aggregator behind a proxy can change without a new address.
const chainlink = createContracts("chainlink", {
  "https://docs.chain.link/data-feeds/price-feeds/addresses?network=bnb-chain": {
    "bnb-usd": "0x0567F2323251f0Aab15c8dFb1967E4e8A7D42aeE",
    "usdt-usd": "0xB97Ad0E74fa7d920791E90258A6E2085088b4320",
    "usdc-usd": "0x51597f405303C4377E36123cBc172b13269EA163",
    "fdusd-usd": "0x390180e80058A8499930F0c13963AD3E0d86Bfc9",
    "btc-usd": "0x264990fbd0A4796A3E3d8E37C4d5F87a3aCa5Ebf",
    "eth-usd": "0x9ef1B8c0E4F7dc8bF5719Ea496883DC6401d5b2e",
  },
});

const erc8004 = createContracts("erc8004", {
  "https://github.com/erc-8004/erc-8004-contracts": {
    "identity-registry": "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432",
  },
});

// Only the registry is fixed: each name's resolver is read from it at the time of use.
const spaceid = createContracts("spaceid", {
  "https://www.npmjs.com/package/@web3-name-sdk/core": {
    registry: "0x08CEd32a7f3eeC915Ba84415e9C07a7286977956",
  },
});

const rpcDocs = "https://docs.bnbchain.org/bnb-smart-chain/developers/json_rpc/json-rpc-endpoint/";
const explorerDocs = "https://docs.bnbchain.org/bnb-smart-chain/developers/quick-guide/";

/** BNB Smart Chain mainnet: its tokens, venue contracts, public RPCs, private relays and explorers. */
export const bsc: ChainDefinition = {
  id: "eip155:56",
  key: "bsc",
  name: "BNB Smart Chain",
  family: "evm",
  nativeAsset: {
    assetNamespace: "slip44",
    assetReference: "714",
    symbol: "BNB",
    name: "BNB",
    decimals: 18,
  },
  blockTimeMs: 450,
  finality: { kind: "finalized_tag" },
  // BNB Chain disables eth_getLogs on these endpoints and allows 10,000 requests in 5 minutes.
  rpcs: [
    { name: "bnbchain-dataseed", url: "https://bsc-dataseed.bnbchain.org", source: rpcDocs },
    {
      name: "bnbchain-dataseed-public",
      url: "https://bsc-dataseed-public.bnbchain.org",
      source: rpcDocs,
    },
  ],
  // Keyless relays only: bloXroute's private send needs an account.
  relays: [
    { name: "club48", url: "https://rpc.48.club", source: "https://docs.48.club/privacy-rpc" },
    {
      name: "blockrazor",
      url: "https://bsc.blockrazor.xyz/fullprivacy",
      source: "https://docs.blockrazor.io/transaction-submission/rpc/bsc/eth_sendrawtransaction",
    },
    {
      name: "pancakeswap-mev-guard",
      url: "https://bscrpc.pancakeswap.finance",
      source: "https://docs.pancakeswap.finance/trading-tools/pancakeswap-mev-guard",
    },
  ],
  explorers: [
    { name: "bscscan", url: "https://bscscan.com", source: explorerDocs },
    { name: "bsctrace", url: "https://bsctrace.com", source: explorerDocs },
  ],
  tokens,
  contracts: [
    ...pancakeswap,
    kyberswapRouter,
    ...fourmeme,
    ...flap,
    ...venus,
    ...lista,
    ...aave,
    ...stakehub,
    ...across,
    ...relay,
    ...chainlink,
    ...erc8004,
    ...spaceid,
  ],
};

/**
 * BSC's standard Chainlink USD feeds, 8 decimals each, with the heartbeat Chainlink publishes.
 * Each names its proxy among the `chainlink` contracts of {@link bsc}.
 */
export const bscPriceFeeds: readonly PriceFeedDefinition[] = [
  { contract: "bnb-usd", symbol: "BNB", decimals: 8, heartbeatSeconds: 27, isStablecoin: false },
  { contract: "usdt-usd", symbol: "USDT", decimals: 8, heartbeatSeconds: 900, isStablecoin: true },
  { contract: "usdc-usd", symbol: "USDC", decimals: 8, heartbeatSeconds: 900, isStablecoin: true },
  {
    contract: "fdusd-usd",
    symbol: "FDUSD",
    decimals: 8,
    heartbeatSeconds: 86_400,
    isStablecoin: true,
  },
  { contract: "btc-usd", symbol: "BTC", decimals: 8, heartbeatSeconds: 60, isStablecoin: false },
  { contract: "eth-usd", symbol: "ETH", decimals: 8, heartbeatSeconds: 60, isStablecoin: false },
];
