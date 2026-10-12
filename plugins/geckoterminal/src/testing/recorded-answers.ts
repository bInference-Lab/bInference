// Answers of GeckoTerminal's public API in the shapes its OpenAPI documents
// (api.geckoterminal.com/docs, v2, read on 2026-10-12). The WBNB pools, candles and price are cut
// from the live answers of 2026-10-12 at about 09:20 UTC, each to fields the docs list; the
// trending pools are written in the documented `pool` schema from pools of that WBNB answer, and
// the error bodies in the documented `errors_object`, as the live 404 came back.

/** WBNB on BNB Smart Chain. */
export const wbnbAddress = "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c";

/** WBNB's deepest pool, PancakeSwap v2's USDT / WBNB, as GeckoTerminal writes its address. */
export const wbnbDeepestPool = "0x16b9a82891338f9ba80e2d6970fdda79d1eb0dae";

/** Two tokens the recorded trending pools name, the first in two pools. */
export const trendingAddresses = [
  "0x924fa68a0FC644485b8df8AbfA0A41C2e7744444",
  "0x2170Ed0880ac9A755fd29B2688956BD959F933F8",
] as const;

/** `GET /networks/bsc/tokens/{WBNB}/pools`, cut to its first three pools, in its order. */
export const wbnbPoolsAnswer: string = `{
  "data": [
    {
      "id": "bsc_0x172fcd41e0913e95784454622d1c3724f546f849",
      "type": "pool",
      "attributes": {
        "base_token_price_usd": "0.9995269665",
        "quote_token_price_usd": "750.99",
        "address": "0x172fcd41e0913e95784454622d1c3724f546f849",
        "name": "USDT / WBNB 0.01%",
        "pool_created_at": "2025-11-09T12:44:04Z",
        "price_change_percentage": { "h1": "-0.1", "h24": "0.57" },
        "volume_usd": { "h1": "3252033.23055186", "h24": "69814198.5787824" },
        "reserve_in_usd": "15727097.1765"
      },
      "relationships": {
        "base_token": { "data": { "id": "bsc_0x55d398326f99059ff775485246999027b3197955", "type": "token" } },
        "quote_token": { "data": { "id": "bsc_0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c", "type": "token" } },
        "dex": { "data": { "id": "pancakeswap-v3-bsc", "type": "dex" } }
      }
    },
    {
      "id": "bsc_0x16b9a82891338f9ba80e2d6970fdda79d1eb0dae",
      "type": "pool",
      "attributes": {
        "base_token_price_usd": "1.0006451335",
        "quote_token_price_usd": "750.99",
        "address": "0x16b9a82891338f9ba80e2d6970fdda79d1eb0dae",
        "name": "USDT / WBNB",
        "pool_created_at": "2021-07-15T07:20:16Z",
        "price_change_percentage": { "h1": "-0.09", "h24": "0.57" },
        "volume_usd": { "h1": "252675.557260049", "h24": "3858571.99006561" },
        "reserve_in_usd": "58334444.3085"
      },
      "relationships": {
        "base_token": { "data": { "id": "bsc_0x55d398326f99059ff775485246999027b3197955", "type": "token" } },
        "quote_token": { "data": { "id": "bsc_0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c", "type": "token" } },
        "dex": { "data": { "id": "pancakeswap_v2", "type": "dex" } }
      }
    },
    {
      "id": "bsc_0x6bbc40579ad1bbd243895ca0acb086bb6300d636",
      "type": "pool",
      "attributes": {
        "base_token_price_usd": "83436.0039095413",
        "quote_token_price_usd": "751.02",
        "address": "0x6bbc40579ad1bbd243895ca0acb086bb6300d636",
        "name": "BTCB / WBNB 0.05%",
        "pool_created_at": "2025-11-14T03:56:05Z",
        "price_change_percentage": { "h1": "-0.09", "h24": "0.58" },
        "volume_usd": { "h1": "156374.594035571", "h24": "5101615.30925224" },
        "reserve_in_usd": "28019090.5434"
      },
      "relationships": {
        "base_token": { "data": { "id": "bsc_0x7130d2a12b9bcbfae4f2634d864a1ee1ce3ead9c", "type": "token" } },
        "quote_token": { "data": { "id": "bsc_0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c", "type": "token" } },
        "dex": { "data": { "id": "pancakeswap-v3-bsc", "type": "dex" } }
      }
    }
  ]
}`;

/** The documented 404 of a token's pools, "Token for specified address not found". */
export const tokenNotFoundAnswer = `{"errors":[{"status":"404","title":"Not Found"}],"meta":{"ref_id":"7596f418-462f-4904-af71-de9725b4a34b"}}`;

/** The documented 400 of a request for more than 30 tokens. */
export const tooManyAddressesAnswer = `{"errors":[{"status":"400","title":"Exceeded maximum number of addresses"}]}`;

/**
 * `GET /networks/bsc/pools/{WBNB's deepest pool}/ohlcv/hour?aggregate=4&limit=3` in USD for
 * WBNB: three 4-hour candles, newest first.
 */
export const wbnbOhlcvAnswer: string = `{
  "data": {
    "id": "9f88eb47-7a13-4eaf-8415-a2e577bb2742",
    "type": "ohlcv_request_response",
    "attributes": {
      "ohlcv_list": [
        [1791792000, 753.96, 753.972475788138, 750.83, 750.99, 506069.0699224211],
        [1791777600, 750.83, 756.78, 750.09, 753.96, 1562492.0115152353],
        [1791763200, 753.47, 754.63, 749.96, 750.83, 462391.1105532743]
      ]
    }
  },
  "meta": {
    "base": {
      "name": "Wrapped BNB",
      "symbol": "WBNB",
      "coingecko_coin_id": "wbnb",
      "address": "0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c"
    },
    "quote": {
      "name": "Tether USD",
      "symbol": "USDT",
      "coingecko_coin_id": "binance-bridged-usdt-bnb-smart-chain",
      "address": "0x55d398326f99059ff775485246999027b3197955"
    }
  }
}`;

/** `GET /networks/bsc/tokens/multi/{WBNB},{a token it knows not}`, cut to the fields read. */
export const wbnbTokensAnswer: string = `{
  "data": [
    {
      "id": "bsc_0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c",
      "type": "token",
      "attributes": {
        "address": "0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c",
        "name": "Wrapped BNB",
        "symbol": "WBNB",
        "decimals": 18,
        "price_usd": "750.08",
        "total_reserve_in_usd": "650249037.4640785924309041081027088445789394997117865",
        "volume_usd": { "h24": "285902774.752424" }
      },
      "relationships": {
        "top_pools": { "data": [{ "id": "bsc_0x172fcd41e0913e95784454622d1c3724f546f849", "type": "pool" }] }
      }
    }
  ]
}`;

/** `GET /networks/bsc/trending_pools`: three pools, the first token's twice. */
export const trendingPoolsAnswer: string = `{
  "data": [
    {
      "id": "bsc_0x66f289de31eef70d52186729d2637ac978cfc56b",
      "type": "pool",
      "attributes": {
        "base_token_price_usd": "0.5837422485",
        "address": "0x66f289de31eef70d52186729d2637ac978cfc56b",
        "name": "Example / WBNB",
        "pool_created_at": "2025-10-04T15:01:32Z",
        "volume_usd": { "h24": "3417595.28710646" },
        "reserve_in_usd": "8735982.195"
      },
      "relationships": {
        "base_token": { "data": { "id": "bsc_0x924fa68a0fc644485b8df8abfa0a41c2e7744444", "type": "token" } },
        "quote_token": { "data": { "id": "bsc_0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c", "type": "token" } },
        "dex": { "data": { "id": "pancakeswap_v2", "type": "dex" } }
      }
    },
    {
      "id": "bsc_0xd0e226f674bbf064f54ab47f42473ff80db98cba",
      "type": "pool",
      "attributes": {
        "base_token_price_usd": "2551.0780847029",
        "address": "0xd0e226f674bbf064f54ab47f42473ff80db98cba",
        "name": "ETH / WBNB 0.05%",
        "pool_created_at": null,
        "volume_usd": { "h24": "5893156.42856526" },
        "reserve_in_usd": "16855118.926"
      },
      "relationships": {
        "base_token": { "data": { "id": "bsc_0x2170ed0880ac9a755fd29b2688956bd959f933f8", "type": "token" } },
        "quote_token": { "data": { "id": "bsc_0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c", "type": "token" } },
        "dex": { "data": { "id": "pancakeswap-v3-bsc", "type": "dex" } }
      }
    },
    {
      "id": "bsc_0x00000000000000000000000000000000000c0ffe",
      "type": "pool",
      "attributes": {
        "base_token_price_usd": "0.58",
        "address": "0x00000000000000000000000000000000000c0ffe",
        "name": "Example / USDT",
        "pool_created_at": "2025-10-05T10:00:00Z",
        "volume_usd": { "h24": "1000.5" },
        "reserve_in_usd": null
      },
      "relationships": {
        "base_token": { "data": { "id": "bsc_0x924fa68a0fc644485b8df8abfa0a41c2e7744444", "type": "token" } },
        "quote_token": { "data": { "id": "bsc_0x55d398326f99059ff775485246999027b3197955", "type": "token" } },
        "dex": { "data": { "id": "pancakeswap_v2", "type": "dex" } }
      }
    }
  ]
}`;
