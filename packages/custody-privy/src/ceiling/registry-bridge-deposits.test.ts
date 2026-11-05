import {
  type BridgeRouteDefinition,
  type ChainDefinition,
  chainRefSchema,
  type VenueDeclaration,
} from "@binference/chain";
import { describe, expect, it } from "vitest";
import { bridgeAddresses, testBridgeCall } from "../testing/bridge-target-fixtures.js";
import { oneBnbWei } from "../testing/custody-fixtures.js";
import { abiFunctionJson } from "./policy-rule.js";
import { registryCeilingChain } from "./registry-ceiling-chain.js";

const verification = {
  source: "https://example.org/docs",
  checkedOn: "2026-10-31",
  control: "read",
} as const;
const endpoint = { name: "rpc", url: "https://rpc.example.org", source: "https://example.org" };

function chainOf(
  id: string,
  key: string,
  family = "evm",
): Omit<ChainDefinition, "tokens" | "contracts"> {
  return {
    id,
    key,
    name: key,
    family,
    nativeAsset: {
      assetNamespace: "slip44",
      assetReference: "60",
      symbol: "ETH",
      name: "Ether",
      decimals: 18,
    },
    blockTimeMs: 1000,
    finality: { kind: "finalized_tag" },
    rpcs: [endpoint],
    relays: [],
    explorers: [
      {
        ...endpoint,
        txUrl: "https://scan.example.org/tx/{hash}",
        addressUrl: "https://scan.example.org/address/{address}",
      },
    ],
  };
}

const token = (symbol: string, address: string) => ({
  symbol,
  name: symbol,
  decimals: 18,
  address,
  verification,
});

const source: ChainDefinition = {
  ...chainOf("eip155:56", "bsc"),
  tokens: [token("USDC", bridgeAddresses.bscUsdc), token("ETH", bridgeAddresses.bscEth)],
  contracts: [
    { venue: "across", name: "spoke-pool", address: bridgeAddresses.spokePool, verification },
    {
      venue: "erc8004",
      name: "identity-registry",
      address: bridgeAddresses.identity,
      verification,
    },
  ],
};
const base: ChainDefinition = {
  ...chainOf("eip155:8453", "base-mainnet"),
  tokens: [token("USDC", bridgeAddresses.baseUsdc)],
  contracts: [],
};
const robinhood: ChainDefinition = {
  ...chainOf("eip155:4663", "robinhood"),
  tokens: [token("WETH", bridgeAddresses.robinhoodWeth)],
  contracts: [],
};
const solana: ChainDefinition = {
  ...chainOf("solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp", "solana", "solana"),
  tokens: [],
  contracts: [],
};

function route(leaves: string, to: string, arrives: string): BridgeRouteDefinition {
  return {
    venue: "across",
    leaves,
    to,
    arrives,
    source: "https://example.org/routes",
    checkedOn: "2026-10-31",
  };
}

const bsc = chainRefSchema.parse("eip155:56");
const across: VenueDeclaration = {
  id: "across",
  contracts: [
    {
      chain: bsc,
      names: ["spoke-pool"],
      calls: [
        {
          contract: "spoke-pool",
          abi: abiFunctionJson(testBridgeCall.abi),
          walletInputs: ["depositor"],
          bridge: { ...testBridgeCall.bridge, minOut: "outputAmount", emptyInputs: ["message"] },
        },
      ],
      spenders: ["spoke-pool"],
    },
  ],
};

function chainWith(bridges: Parameters<typeof registryCeilingChain>[0]["bridges"]) {
  return registryCeilingChain({
    definition: source,
    venues: [across],
    perTxNativeCapBase: oneBnbWei,
    ...(bridges === undefined ? {} : { bridges }),
  });
}

// The plan's deposits, or the refusal.
function depositsOf(bridges: Parameters<typeof registryCeilingChain>[0]["bridges"]) {
  const chain = chainWith(bridges);
  return chain.ok ? chain.value.bridges : chain.error;
}

// The plan's plain calls, or the refusal.
function restOf(bridges: Parameters<typeof registryCeilingChain>[0]["bridges"]) {
  const chain = chainWith(bridges);
  return chain.ok ? chain.value.calls : chain.error;
}

const routes = [
  route("USDC", "base-mainnet", "USDC"),
  route("ETH", "robinhood", "WETH"),
  { ...route("USDC", "solana", "USDC"), venue: "relay" },
];

describe("bridge deposits from the registry", () => {
  it("makes one deposit per destination a route reaches, and no plain call", () => {
    const plan = { routes, destinations: [base, robinhood] };
    expect(restOf(plan)).toStrictEqual([]);
    expect(depositsOf(plan)).toStrictEqual([
      {
        call: { ...testBridgeCall },
        destinationChainId: "8453",
        routes: [{ tokenIn: bridgeAddresses.bscUsdc, tokenOut: bridgeAddresses.baseUsdc }],
      },
      {
        call: { ...testBridgeCall },
        destinationChainId: "4663",
        routes: [{ tokenIn: bridgeAddresses.bscEth, tokenOut: bridgeAddresses.robinhoodWeth }],
      },
    ]);
  });

  it("makes no deposit where no route of the venue goes, or no 20-byte address is paid", () => {
    const deposits = depositsOf({
      routes: routes.filter((item) => item.to !== "base-mainnet"),
      destinations: [base, robinhood, solana],
    });
    expect(deposits).toMatchObject([{ destinationChainId: "4663" }]);
    expect(depositsOf(undefined)).toBeUndefined();
  });

  it("makes no deposit, call or spender of a main wallet's bridge in a bridge wallet's ceiling", () => {
    const chain = registryCeilingChain({
      definition: source,
      venues: [across],
      perTxNativeCapBase: oneBnbWei,
      role: "bridge",
      bridges: { routes, destinations: [base, robinhood] },
    });
    expect(chain).toMatchObject({ ok: true, value: { calls: [], spenders: [] } });
    expect(chain).not.toHaveProperty("value.bridges");
  });

  it("refuses a route whose token a chain does not list", () => {
    expect(
      depositsOf({ routes: [route("USDT", "base-mainnet", "USDT")], destinations: [base] }),
    ).toBe("unknown_token");
  });
});
