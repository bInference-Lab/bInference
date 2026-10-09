// Answers of GoPlus's Token Security API on BSC (chain id 56), recorded on 2026-10-09 at about
// 17:40 UTC without an access token. Holder lists are cut to their first entry; every other field
// is as GoPlus sent it.

/** WebKey DAO 2.0 (wkeyDAO2): a 40% sell tax, a hidden owner and a changeable tax. */
export const taxedTokenAnswer: string = `{
  "code": 1,
  "message": "OK",
  "result": {
    "0xe0a281deff5c9d8d67af09d39340e134ac81b82e": {
      "anti_whale_modifiable": "0",
      "buy_tax": "0",
      "can_take_back_ownership": "0",
      "cannot_buy": "0",
      "cannot_sell_all": "0",
      "creator_address": "0x14734534efc59d3dcdbecccfe79c74fda0e124a8",
      "creator_balance": "0.0002",
      "creator_percent": "0.000000",
      "dex": [
        {
          "liquidity_type": "UniV2",
          "name": "PancakeV2",
          "liquidity": "3576285.43599902",
          "pool_fee": "0.0025",
          "pair": "0xb720ea2a201c03578cca05191e8b4ab859704cfe"
        },
        {
          "liquidity_type": "UniV4",
          "name": "UniswapV4",
          "liquidity": "0.132074735000049041353656",
          "pool_manager": "0x28e2ea090877bf75740558f6bfb36a5ffee9e9df",
          "pool_fee": "0.3",
          "pair": "0xc5e3821b35d0704db386c34015cefbded88d707c6713283dd8f72977991c7bfe"
        },
        {
          "liquidity_type": "UniV4",
          "name": "Pancake Infinity CL",
          "liquidity": "0.078122459994479786785554",
          "pool_manager": "0xa0FfB9c1CE1Fe56963B0321B32E7A0302114058b",
          "pool_fee": "0.963855",
          "pair": "0x1bfc400d54735cb1028ebd7f2dfb458b0bf099e734a7ffd72aae04f1a417bbc2"
        },
        {
          "liquidity_type": "UniV4",
          "name": "Pancake Infinity CL",
          "liquidity": "0.078072196346474213501907",
          "pool_manager": "0xa0FfB9c1CE1Fe56963B0321B32E7A0302114058b",
          "pool_fee": "0.993975",
          "pair": "0xf4accd5b53054ec939b036e8a72ce0bc6cd7003bfa35483b7caa0c7c579d275f"
        },
        {
          "liquidity_type": "UniV4",
          "name": "Pancake Infinity CL",
          "liquidity": "0.052112492974975616847948",
          "pool_manager": "0xa0FfB9c1CE1Fe56963B0321B32E7A0302114058b",
          "pool_fee": "0.986947",
          "pair": "0xf22c63890481f095de62c979690aa404c569bc000960317a07c8ea43dfbfe505"
        },
        {
          "liquidity_type": "UniV4",
          "name": "UniswapV4",
          "liquidity": "0.009967627417100215003596",
          "pool_manager": "0x28e2ea090877bf75740558f6bfb36a5ffee9e9df",
          "pair": "0x336442ee9d925338c85c700b9cf76235b09c0205f39c8f131c6a8e9f7e194814"
        },
        {
          "liquidity_type": "UniV4",
          "name": "Pancake Infinity CL",
          "liquidity": "0.002738106560489449537628",
          "pool_manager": "0xa0FfB9c1CE1Fe56963B0321B32E7A0302114058b",
          "pool_fee": "0.984337",
          "pair": "0xd60f56d929b721853ee3e325e6267b8eaf4d8dc84ec52e7f3dd783cc7e303683"
        },
        {
          "liquidity_type": "UniV4",
          "name": "Pancake Infinity CL",
          "liquidity": "0.000537743814804519531395",
          "pool_manager": "0xa0FfB9c1CE1Fe56963B0321B32E7A0302114058b",
          "pool_fee": "0.999899",
          "pair": "0xdb4cf8b48d8d152a27be5e710e8fbd8e33054c0f487103c960647edc837eebc2"
        },
        {
          "liquidity_type": "UniV4",
          "name": "Pancake Infinity CL",
          "liquidity": "0.000010851170419657587018",
          "pool_manager": "0xa0FfB9c1CE1Fe56963B0321B32E7A0302114058b",
          "pool_fee": "0.979919",
          "pair": "0x42524facf8439618e54bc6b7ddbfaf04f25625ebe9adb2bd5c3be9713ccb81b8"
        },
        {
          "liquidity_type": "UniV4",
          "name": "Pancake Infinity CL",
          "liquidity": "0.000000833309346547452208",
          "pool_manager": "0xa0FfB9c1CE1Fe56963B0321B32E7A0302114058b",
          "pool_fee": "0.908534",
          "pair": "0xaabdece5ca331c7c6ed7d55c3ce18d10f7533408218a46a186f53f194db31ec2"
        }
      ],
      "external_call": "0",
      "hidden_owner": "1",
      "holder_count": "374923",
      "holders": [
        {
          "address": "0x92c5ff8f197f668ba44ecbf4bd16a66853c2ea4e",
          "tag": "",
          "is_contract": 1,
          "balance": "251588234.132135537",
          "percent": "0.528207364672894338",
          "is_locked": 0
        }
      ],
      "honeypot_with_same_creator": "0",
      "is_anti_whale": "0",
      "is_blacklisted": "0",
      "is_honeypot": "0",
      "is_in_dex": "1",
      "is_mintable": "1",
      "is_open_source": "1",
      "is_proxy": "0",
      "is_whitelisted": "0",
      "lp_holder_count": "4",
      "lp_holders": [
        {
          "address": "0xaa20cbf7fe90f131033731c8b6d6b507d8a21dec",
          "tag": "",
          "value": "3576238.954847527699484230",
          "is_contract": 1,
          "balance": "109.700835298069291185",
          "percent": "0.999987002952554587",
          "is_locked": 0
        }
      ],
      "lp_total_supply": "109.70226110356172325",
      "owner_balance": "0",
      "owner_change_balance": "0",
      "owner_percent": "0",
      "personal_slippage_modifiable": "0",
      "selfdestruct": "0",
      "sell_tax": "0.4001",
      "slippage_modifiable": "1",
      "token_name": "WebKey DAO 2.0",
      "token_symbol": "wkeyDAO2",
      "total_supply": "476305805.179255428",
      "trading_cooldown": "0",
      "transfer_pausable": "0",
      "transfer_tax": "0"
    }
  }
}`;

/** MS: a 36.3% sell tax, a holder cannot sell all, and transfers can be paused. */
export const sellAllBlockedAnswer: string = `{
  "code": 1,
  "message": "OK",
  "result": {
    "0x6dc3bcecee446633cf9c95736c07d18d9cc046c4": {
      "anti_whale_modifiable": "0",
      "buy_tax": "0",
      "can_take_back_ownership": "0",
      "cannot_buy": "0",
      "cannot_sell_all": "1",
      "creator_address": "0xf44c7a2b70a8ece1fe4f599c0b77f19734b01aca",
      "creator_balance": "0",
      "creator_percent": "0.000000",
      "dex": [
        {
          "liquidity_type": "UniV2",
          "name": "PancakeV2",
          "liquidity": "1696390.00386285",
          "pool_fee": "0.0025",
          "pair": "0xeed3e35a7436617782d887a2bcbcd1ff6092e9f5"
        },
        {
          "liquidity_type": "UniV4",
          "name": "Pancake Infinity CL",
          "liquidity": "0.010617279574915700838138",
          "pool_manager": "0xa0FfB9c1CE1Fe56963B0321B32E7A0302114058b",
          "pool_fee": "0.7001",
          "pair": "0x49e43ea817cbf87e96d556da4146766660408e81b390122804d5ee6783da124b"
        }
      ],
      "external_call": "1",
      "hidden_owner": "0",
      "holder_count": "2603",
      "holders": [
        {
          "address": "0xeed3e35a7436617782d887a2bcbcd1ff6092e9f5",
          "tag": "PancakeV2",
          "is_contract": 1,
          "balance": "337156121.330338442951476915",
          "percent": "0.337156121330338442",
          "is_locked": 0
        }
      ],
      "honeypot_with_same_creator": "0",
      "is_anti_whale": "0",
      "is_blacklisted": "0",
      "is_honeypot": "0",
      "is_in_dex": "1",
      "is_mintable": "0",
      "is_open_source": "1",
      "is_proxy": "0",
      "is_whitelisted": "0",
      "lp_holder_count": "3",
      "lp_holders": [
        {
          "address": "0x000000000000000000000000000000000000dead",
          "tag": "",
          "value": "1696384.263805168255369699",
          "is_contract": 0,
          "balance": "247825028.382199267742453769",
          "percent": "0.999996616310123077",
          "is_locked": 1
        }
      ],
      "lp_total_supply": "247825866.948076499419036631",
      "owner_address": "0x555154795ec4144d901a7530e500d8e5b2aec2e3",
      "owner_balance": "0",
      "owner_change_balance": "0",
      "owner_percent": "0.0",
      "personal_slippage_modifiable": "0",
      "selfdestruct": "0",
      "sell_tax": "0.363",
      "slippage_modifiable": "1",
      "token_name": "MS",
      "token_symbol": "MS",
      "total_supply": "1000000000",
      "trading_cooldown": "0",
      "transfer_pausable": "1",
      "transfer_tax": "0"
    }
  }
}`;

/** The answer for an address that holds no token, such as the dead address. */
export const emptyAnswer: string = '{"code":1,"message":"OK","result":{}}';

/** GoPlus's answer for a chain id it does not serve. */
export const unsupportedChainAnswer: string =
  '{"code":2022,"message":"The main chain is not supported","result":null}';

/** GoPlus's answer for a malformed address. */
export const systemErrorAnswer: string = '{"code":5000,"message":"system error","result":null}';
