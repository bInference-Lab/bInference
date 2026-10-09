// Answers of honeypot.is's IsHoneypot endpoint on BSC (chain id 56), recorded on 2026-10-09 at
// about 18:20 UTC without an API key. Each holder analysis keeps its first two tax buckets and the
// summary flags lose their English descriptions; every other field is as honeypot.is sent it.

/** WebKey DAO 2.0 (wkeyDAO2): a 40% sell tax and code it cannot read, so high risk. */
export const taxedTokenAnswer: string = `{
  "token": {
    "name": "WebKey DAO 2.0",
    "symbol": "wkeyDAO2",
    "decimals": 9,
    "address": "0xe0A281deFf5c9d8d67aF09D39340E134Ac81b82E",
    "totalHolders": 373882
  },
  "withToken": {
    "name": "Tether USD",
    "symbol": "USDT",
    "decimals": 18,
    "address": "0x55d398326f99059fF775485246999027B3197955",
    "totalHolders": 79719757
  },
  "summary": {
    "risk": "high",
    "riskLevel": 51,
    "flags": [
      {
        "flag": "closed_source",
        "severity": "high",
        "severityIndex": 16
      }
    ]
  },
  "simulationSuccess": true,
  "honeypotResult": {
    "isHoneypot": false
  },
  "simulationResult": {
    "buyTax": 0,
    "sellTax": 40,
    "transferTax": 0,
    "buyGas": "152913",
    "sellGas": "288961"
  },
  "holderAnalysis": {
    "holders": "12309",
    "successful": "12309",
    "failed": "0",
    "siphoned": "0",
    "averageTax": 17.72844666504093,
    "averageGas": 379219.14046632545,
    "highestTax": 40,
    "highTaxWallets": "0",
    "taxDistribution": [
      {
        "tax": 0,
        "count": 1
      },
      {
        "tax": 3,
        "count": 972
      }
    ],
    "snipersFailed": 0,
    "snipersSuccess": 0
  },
  "flags": [],
  "contractCode": {
    "openSource": false,
    "rootOpenSource": true,
    "isProxy": false,
    "hasProxyCalls": true
  },
  "chain": {
    "id": "56",
    "name": "Binance Smart Chain",
    "shortName": "bsc",
    "currency": "BNB"
  },
  "router": "0x10ED43C718714eb63d5aA57B78B54704E256024E",
  "pair": {
    "pair": {
      "name": "PancakeSwap V2: USDT-wkeyDAO2",
      "address": "0xB720eA2a201C03578CcA05191E8b4ab859704cFe",
      "token0": "0x55d398326f99059fF775485246999027B3197955",
      "token1": "0xe0A281deFf5c9d8d67aF09D39340E134Ac81b82E",
      "type": "UniswapV2"
    },
    "chainId": "56",
    "reserves0": "19538525828182801094162701",
    "reserves1": "8785014556645916",
    "liquidity": 39045047.55105904,
    "router": "0x10ED43C718714eb63d5aA57B78B54704E256024E",
    "createdAtTimestamp": "1767955759",
    "creationTxHash": "0x5351bd88d64b9f93fa9f73dbc0b85d98751bea7a4d43e1f03ff99290888fbfb3"
  },
  "pairAddress": "0xB720eA2a201C03578CcA05191E8b4ab859704cFe"
}`;

/** SPA: a honeypot whose test sale fails and whose holders' sales mostly fail. */
export const honeypotAnswer: string = `{
  "token": {
    "name": "SPA",
    "symbol": "SPA",
    "decimals": 18,
    "address": "0xE77E41c26B6460Afccb9971CA11Fa968647c43B7",
    "totalHolders": 68835
  },
  "withToken": {
    "name": "Tether USD",
    "symbol": "USDT",
    "decimals": 18,
    "address": "0x55d398326f99059fF775485246999027B3197955",
    "totalHolders": 79719757
  },
  "summary": {
    "risk": "honeypot",
    "riskLevel": 100,
    "flags": [
      {
        "flag": "medium_siphon_rate",
        "severity": "high",
        "severityIndex": 16
      },
      {
        "flag": "high_fail_rate",
        "severity": "critical",
        "severityIndex": 20
      }
    ]
  },
  "simulationSuccess": true,
  "honeypotResult": {
    "isHoneypot": true,
    "honeypotReason": "execution reverted: TransferHelper: TRANSFER_FROM_FAILED: 0x08c379a0000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000000245472616e7366657248656c7065723a205452414e534645525f46524f4d5f4641494c454400000000000000000000000000000000000000000000000000000000"
  },
  "simulationResult": {
    "maxSell": {
      "token": 55738.1503148423,
      "tokenWei": "55738150314842297554363",
      "withToken": 44368.71064849145,
      "withTokenWei": "44368710648491449063040"
    },
    "buyTax": 0,
    "sellTax": 100,
    "transferTax": 0,
    "buyGas": "0",
    "sellGas": "0"
  },
  "holderAnalysis": {
    "holders": "4635",
    "successful": "2662",
    "failed": "1953",
    "siphoned": "20",
    "averageTax": 4.016596543951937,
    "averageGas": 356228.9966190834,
    "highestTax": 4.79,
    "highTaxWallets": "0",
    "taxDistribution": [
      {
        "tax": 3,
        "count": 537
      },
      {
        "tax": 4,
        "count": 2125
      }
    ],
    "snipersFailed": 0,
    "snipersSuccess": 0
  },
  "flags": [
    "medium_siphon_rate",
    "high_fail_rate"
  ],
  "contractCode": {
    "openSource": true,
    "rootOpenSource": true,
    "isProxy": false,
    "hasProxyCalls": false
  },
  "chain": {
    "id": "56",
    "name": "Binance Smart Chain",
    "shortName": "bsc",
    "currency": "BNB"
  },
  "router": "0x10ED43C718714eb63d5aA57B78B54704E256024E",
  "pair": {
    "pair": {
      "name": "PancakeSwap V2: USDT-SPA",
      "address": "0x9400ad3c7506Ae4e34aE9b55Fc61E906691C3b12",
      "token0": "0x55d398326f99059fF775485246999027B3197955",
      "token1": "0xE77E41c26B6460Afccb9971CA11Fa968647c43B7",
      "type": "UniswapV2"
    },
    "chainId": "56",
    "reserves0": "35002459894456238006523",
    "reserves1": "196146671500385543173863",
    "liquidity": 69962.4268026006,
    "router": "0x10ED43C718714eb63d5aA57B78B54704E256024E",
    "createdAtTimestamp": "1751113805",
    "creationTxHash": "0x2c50542aa617c46c7da577d6a297572bc7f1795b4ee7ce25a628dd716ffce0ca"
  },
  "pairAddress": "0x9400ad3c7506Ae4e34aE9b55Fc61E906691C3b12"
}`;

/** The answer for an address it knows no token at, such as the dead address. */
export const tokenNotFoundAnswer: string = '{"code":404,"error":"Token not found"}';
