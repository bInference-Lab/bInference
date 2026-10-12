// Answers of DEX Screener's public API in the shapes its API reference documents
// (docs.dexscreener.com/api/reference, read on 2026-10-12). The WBNB pairs are cut from the live
// answer of 2026-10-12 at about 06:00 UTC, each pair to the fields the reference lists; the
// boosted tokens' pairs are written from the reference's `Pair` schema, their figures made up.

/** WBNB on BNB Smart Chain, as `/token-pairs/v1/bsc/{tokenAddress}` names it. */
export const wbnbAddress = "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c";

/** Two tokens DEX Screener ranked among its top boosts on 2026-10-12. */
export const boostedAddresses = [
  "0x770F732c39fdaB1DbB098ed8672f4b16C0E87777",
  "0x8344A74ABf9e31bFC9A4d0a2443826C768647777",
] as const;

/** `GET /token-pairs/v1/bsc/{WBNB}`, cut to its first three pairs, in DEX Screener's order. */
export const wbnbPairsAnswer: string = `[
  {
    "chainId": "bsc",
    "dexId": "pancakeswap",
    "url": "https://dexscreener.com/bsc/0x172fcd41e0913e95784454622d1c3724f546f849",
    "pairAddress": "0x172fcD41E0913e95784454622d1c3724f546f849",
    "labels": ["v3"],
    "baseToken": { "address": "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c", "name": "Wrapped BNB", "symbol": "WBNB" },
    "quoteToken": { "address": "0x55d398326f99059fF775485246999027B3197955", "name": "Tether USD", "symbol": "USDT" },
    "priceNative": "752.5717",
    "priceUsd": "752.57",
    "txns": { "m5": { "buys": 258, "sells": 219 }, "h24": { "buys": 110790, "sells": 71005 } },
    "volume": { "h24": 63177266.8, "h6": 21265463.96, "h1": 4351627.3, "m5": 233659.37 },
    "priceChange": { "m5": -0.12, "h1": -0.2, "h6": -0.09, "h24": 0.87 },
    "liquidity": { "usd": 15682125.43, "base": 7374.6019, "quote": 10132150 },
    "fdv": 1167028686,
    "marketCap": 1167556474,
    "pairCreatedAt": 1680703943000
  },
  {
    "chainId": "bsc",
    "dexId": "pancakeswap",
    "url": "https://dexscreener.com/bsc/0xf2688fb5b81049dfb7703ada5e770543770612c4",
    "pairAddress": "0xf2688Fb5B81049DFB7703aDa5e770543770612C4",
    "labels": ["v3"],
    "baseToken": { "address": "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c", "name": "Wrapped BNB", "symbol": "WBNB" },
    "quoteToken": { "address": "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d", "name": "USD Coin", "symbol": "USDC" },
    "priceNative": "751.8065",
    "priceUsd": "751.80",
    "txns": { "h24": { "buys": 39930, "sells": 31531 } },
    "volume": { "h24": 10331060.79, "h6": 2670451.8, "h1": 413271, "m5": 14455.45 },
    "priceChange": { "m5": -0.07, "h1": -0.29, "h6": -0.26, "h24": 0.77 },
    "liquidity": { "usd": 1972663.63, "base": 995.2845, "quote": 1224402 },
    "fdv": 1164325957,
    "marketCap": 1164325957,
    "pairCreatedAt": 1681292327000
  },
  {
    "chainId": "bsc",
    "dexId": "pancakeswap",
    "url": "https://dexscreener.com/bsc/0x16b9a82891338f9ba80e2d6970fdda79d1eb0dae",
    "pairAddress": "0x16b9a82891338f9bA80E2D6970FddA79D1eb0daE",
    "labels": ["v2"],
    "baseToken": { "address": "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c", "name": "Wrapped BNB", "symbol": "WBNB" },
    "quoteToken": { "address": "0x55d398326f99059fF775485246999027B3197955", "name": "Tether USD", "symbol": "USDT" },
    "priceNative": "753.7400",
    "priceUsd": "753.74",
    "txns": { "h24": { "buys": 20114, "sells": 18032 } },
    "volume": { "h24": 9412233.1 },
    "priceChange": { "h24": -1.05 },
    "liquidity": { "usd": 58489446.8, "base": 38798, "quote": 29244724 },
    "fdv": 1167028686,
    "marketCap": 1167556474,
    "pairCreatedAt": 1619494741000
  }
]`;

/** `GET /token-pairs/v1/bsc/{tokenAddress}` for a token DEX Screener knows no pool of. */
export const noPairsAnswer = "[]";

/** `GET /token-boosts/top/v1`: two tokens on BNB Smart Chain around one on Solana. */
export const topBoostsAnswer: string = `[
  {
    "url": "https://dexscreener.com/bsc/0x770f732c39fdab1dbb098ed8672f4b16c0e87777",
    "chainId": "bsc",
    "tokenAddress": "0x770F732c39fdaB1DbB098ed8672f4b16C0E87777",
    "amount": 500,
    "totalAmount": 1500,
    "description": null,
    "links": null
  },
  {
    "url": "https://dexscreener.com/solana/8pgyhckvsujezhkv7klwmacnmsjle1ybrm1zvdvapump",
    "chainId": "solana",
    "tokenAddress": "8PGyHCKvSUjezHkV7KLwMacnmSJLe1YbRM1zvDVApump",
    "amount": 100,
    "totalAmount": 1000
  },
  {
    "url": "https://dexscreener.com/bsc/0x8344a74abf9e31bfc9a4d0a2443826c768647777",
    "chainId": "bsc",
    "tokenAddress": "0x8344A74ABf9e31bFC9A4d0a2443826C768647777",
    "amount": 50,
    "totalAmount": 500
  }
]`;

/** `GET /tokens/v1/bsc/{both boosted tokens}`: one pool of the first, none of the second. */
export const boostedTokensAnswer: string = `[
  {
    "chainId": "bsc",
    "dexId": "pancakeswap",
    "url": "https://dexscreener.com/bsc/0x00000000000000000000000000000000000c0ffe",
    "pairAddress": "0x00000000000000000000000000000000000c0ffe",
    "labels": ["v2"],
    "baseToken": { "address": "0x770F732c39fdaB1DbB098ed8672f4b16C0E87777", "name": "Example", "symbol": "EXAMPLE" },
    "quoteToken": { "address": "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c", "name": "Wrapped BNB", "symbol": "WBNB" },
    "priceNative": "0.0000001",
    "priceUsd": "0.00007525",
    "txns": { "h24": { "buys": 1200, "sells": 800 } },
    "volume": { "h24": 250000.5 },
    "priceChange": { "h24": 312.456 },
    "liquidity": { "usd": 84000.25, "base": 600000000, "quote": 55.8 },
    "fdv": 75250,
    "marketCap": 75250,
    "pairCreatedAt": 1791700000000
  }
]`;
