// Answers of KyberSwap's aggregator API on BSC, recorded on 2026-10-07 at about 13:06 UTC with the
// client id `binference`, for 0.1 BNB to USDT and for BNB to a token no pool holds.

/** A route through a PancakeSwap Infinity pool behind the FairFlow hook `0x44428C6c…fdFD2`. */
export const hookedRoute: string = `{
  "code": 0,
  "message": "successfully",
  "data": {
    "routeSummary": {
      "tokenIn": "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
      "amountIn": "100000000000000000",
      "amountInUsd": "76.71378901717583",
      "tokenOut": "0x55d398326f99059ff775485246999027b3197955",
      "amountOut": "73330472622321619266",
      "amountOutUsd": "73.35856781396267",
      "gas": "287581",
      "gasPrice": "50000000",
      "gasUsd": "0.01103071407967422",
      "l1FeeUsd": "0",
      "extraFee": {
        "feeAmount": "",
        "chargeFeeBy": "",
        "isInBps": false,
        "feeReceiver": ""
      },
      "route": [
        [
          {
            "pool": "0x1156f415e79cc1c19f1b442f21a62b40d4d3f20e24b4daf93ab1373b4c97fecc",
            "tokenIn": "0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c",
            "tokenOut": "0x55d398326f99059ff775485246999027b3197955",
            "swapAmount": "100000000000000000",
            "amountOut": "73330472622321619266",
            "exchange": "pancake-infinity-cl-fairflow",
            "poolType": "pancake-infinity-cl",
            "poolExtra": {
              "blockNumber": 126257075,
              "vault": "0x238a358808379702088667322f80ac48bad5e6c4",
              "poolManager": "0xa0ffb9c1ce1fe56963b0321b32e7a0302114058b",
              "permit2Addr": "0x31c2f6fcff4f8759b3bd5bf0e1084a055615c768",
              "tokenIn": "0x0000000000000000000000000000000000000000",
              "tokenOut": "0x55d398326f99059ff775485246999027b3197955",
              "fee": 61,
              "parameters": "0x00000000000000000000000000000000000000000000000000000000000108c0",
              "hookAddress": "0x44428c6ce391915d51f963c0dd395cd0f95fdfd2",
              "hookData": "",
              "priceLimit": "4295128740",
              "swapFee": 91
            },
            "extra": {
              "HookSwapInfo": null,
              "_cs": "14718986203811601135",
              "_ts": "1791378405",
              "nSqrtRx96": "2194184717216482503384255293185",
              "nT": 66428,
              "rAI": "0",
              "ri": "dedd4b812ONJt6Et"
            }
          }
        ]
      ],
      "routerAddress": "0x6131B5fae19EA4f9D964eAc0408E4408b66337b5",
      "routeID": "dedd4b812ONJt6Et",
      "checksum": "14718986203811601135",
      "timestamp": 1791378405
    },
    "routerAddress": "0x6131B5fae19EA4f9D964eAc0408E4408b66337b5"
  },
  "requestId": "dedd4b81-d8e3-49b7-a12d-cfe213646f34"
}`;

/** The route without FairFlow pools: an Infinity pool with no hook (the zero address). */
export const hooklessRoute: string = `{
  "code": 0,
  "message": "successfully",
  "data": {
    "routeSummary": {
      "tokenIn": "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
      "amountIn": "100000000000000000",
      "amountInUsd": "76.75563175843",
      "tokenOut": "0x55d398326f99059ff775485246999027b3197955",
      "amountOut": "76697414709402514376",
      "amountOutUsd": "76.73377420592354",
      "gas": "287581",
      "gasPrice": "50000000",
      "gasUsd": "0.01103673066836053",
      "l1FeeUsd": "0",
      "extraFee": {
        "feeAmount": "",
        "chargeFeeBy": "",
        "isInBps": false,
        "feeReceiver": ""
      },
      "route": [
        [
          {
            "pool": "0xd37aa0f0d66ad670279f6b89325c88bdff17d0265144762fb01f54fca9779944",
            "tokenIn": "0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c",
            "tokenOut": "0x55d398326f99059ff775485246999027b3197955",
            "swapAmount": "100000000000000000",
            "amountOut": "76697414709402514376",
            "exchange": "pancake-infinity-cl",
            "poolType": "pancake-infinity-cl",
            "poolExtra": {
              "blockNumber": 126257136,
              "vault": "0x238a358808379702088667322f80ac48bad5e6c4",
              "poolManager": "0xa0ffb9c1ce1fe56963b0321b32e7a0302114058b",
              "permit2Addr": "0x31c2f6fcff4f8759b3bd5bf0e1084a055615c768",
              "tokenIn": "0x0000000000000000000000000000000000000000",
              "tokenOut": "0x55d398326f99059ff775485246999027b3197955",
              "fee": 67,
              "parameters": "0x0000000000000000000000000000000000000000000000000000000000010000",
              "hookAddress": "0x0000000000000000000000000000000000000000",
              "hookData": "",
              "priceLimit": "4295128740",
              "swapFee": 99
            },
            "extra": {
              "HookSwapInfo": null,
              "_cs": "8392520376695044425",
              "_ts": "1791378407",
              "nSqrtRx96": "2194190810037873367099192382017",
              "nT": 66428,
              "rAI": "0",
              "ri": "f4d85936PzhJI73A"
            }
          }
        ]
      ],
      "routerAddress": "0x6131B5fae19EA4f9D964eAc0408E4408b66337b5",
      "routeID": "f4d85936PzhJI73A",
      "checksum": "8392520376695044425",
      "timestamp": 1791378407
    },
    "routerAddress": "0x6131B5fae19EA4f9D964eAc0408E4408b66337b5"
  },
  "requestId": "f4d85936-3f38-4923-bdc0-f340ec2d5656"
}`;

/** The answer for a token no pool holds: HTTP 400, code 4008. */
export const noRouteAnswer: string = `{
  "code": 4008,
  "message": "route not found",
  "details": null,
  "requestId": "22c4587a-c136-4e2f-94a4-809a359322b1"
}`;
