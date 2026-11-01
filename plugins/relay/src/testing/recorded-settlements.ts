import {
  accountRefSchema,
  assetRefSchema,
  BinferenceError,
  type ChainEvent,
  type ChainRef,
  chainRefSchema,
  isTxHash,
  type SettlementCheck,
  type TxHash,
} from "@binference/plugin-sdk";

// Logs of real Relay transactions, read on 2026-11-01 from BNB Smart Chain's and Base's public
// RPCs and Solana's, each as a delivery reader gives it: the depository's deposit events and the
// token transfers beside them, a fill on Base of 0.343283 USDC, a fill on Solana of 4.646595 USDC
// whose memos name its order and its request, and a refund of USDT on BSC.

function hashOf(text: string): TxHash {
  if (!isTxHash(text)) {
    throw new BinferenceError({
      code: "relay.bad_fixture",
      message: "A recorded hash is no transaction hash.",
    });
  }
  return text;
}

const bsc = chainRefSchema.parse("eip155:56");
const base = chainRefSchema.parse("eip155:8453");
const solana = chainRefSchema.parse("solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp");
const solver = "0xf70da97812cb96acdf810712aa562db8dfa3dbef";
const bscUsdc = "0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d";
const word = (address: string): string => `0x${address.slice(2).padStart(64, "0")}`;

// An ERC-20 `Transfer` log of `token` on `chain`, of the value written as a 32-byte word.
function transferOn(
  chain: ChainRef,
  token: string,
  move: { readonly from: string; readonly to: string; readonly value: string },
): ChainEvent {
  return {
    emitter: accountRefSchema.parse(`${chain}:${token}`),
    topics: [
      "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
      word(move.from),
      word(move.to),
    ],
    data: move.value,
  };
}

// The depository's `RelayErc20Deposit` log on BSC, its data as the chain wrote it.
function depositedOnBsc(data: string): ChainEvent {
  return {
    emitter: accountRefSchema.parse(`${bsc}:0x4cd00e387622c35bddb9b4c962c136462338bc31`),
    topics: ["0x49fed1d0b752ce30eee63c7a81133f3363b532fec5d4d7dd1ccfd005de4555e1"],
    data,
  };
}

const basePerson = "0x3692dea4346c95eb3957d8022c40373ab2a21369";
const baseFillValue = "0x0000000000000000000000000000000000000000000000000000000000053cf3";

/** The fill matched to the BSC deposit that paid its order, as the host asks it. */
export const recordedFillCheck: SettlementCheck = {
  kind: "fill",
  deposit: {
    ref: {
      chain: bsc,
      hash: hashOf("0x1bf6374e215d2c42b383149994fdc749435db9f7b5fdcf25c1cea0ef873a04ca"),
    },
    // The BSC deposit of USDC for Base: its token transfer and its deposit event.
    events: [
      transferOn(bsc, bscUsdc, {
        from: basePerson,
        to: "0x4cd00e387622c35bddb9b4c962c136462338bc31",
        value: "0x00000000000000000000000000000000000000000000000005131c2cdc74d32c",
      }),
      depositedOnBsc(
        "0x0000000000000000000000003692dea4346c95eb3957d8022c40373ab2a213690000000000000000000000008ac76a51cc950d9822d68b83fe1ad97b32cd580d00000000000000000000000000000000000000000000000005131c2cdc74d32cd966abf804f33afc2ae5ff8370dc0b28ac388ecc40f468061b28f74733276ff0",
      ),
    ],
  },
  settlement: {
    ref: {
      chain: base,
      hash: hashOf("0xc271169154e8dbd4805b0ce299060677b1ae2ded518335eb298ee00cd764a82f"),
    },
    // The Base fill: Relay's solver sends the recipient USDC.
    events: [
      transferOn(base, "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", {
        from: solver,
        to: basePerson,
        value: baseFillValue,
      }),
    ],
  },
  wallet: accountRefSchema.parse(`${bsc}:${basePerson}`),
  amountIn: {
    asset: assetRefSchema.parse("eip155:56/erc20:0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d"),
    base: 0x05_13_1c_2c_dc_74_d3_2cn,
  },
  recipient: accountRefSchema.parse(`${base}:${basePerson}`),
  minOut: {
    asset: assetRefSchema.parse("eip155:8453/erc20:0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"),
    base: 343_283n,
  },
};

/**
 * The same fill with its transfer sent by another account, not Relay's solver: a bare transfer
 * that pays nobody's order.
 */
export const recordedBareTransferCheck: SettlementCheck = {
  ...recordedFillCheck,
  settlement: {
    ...recordedFillCheck.settlement,
    events: [
      transferOn(base, "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", {
        from: "0x1111111111111111111111111111111111111111",
        to: basePerson,
        value: baseFillValue,
      }),
    ],
  },
};

const memo = "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr";

/** The Solana fill matched to the BSC deposit, through Relay's router, that paid its order. */
export const recordedSolanaFillCheck: SettlementCheck = {
  kind: "fill",
  deposit: {
    ref: {
      chain: bsc,
      hash: hashOf("0x52f0b7f6ac2c0bf26a8bc90c581bee700fa376b607f43b7792055456618c51e4"),
    },
    events: [
      depositedOnBsc(
        "0x00000000000000000000000048c732546476dacbbd688e3b2ce79ab22709221d0000000000000000000000008ac76a51cc950d9822d68b83fe1ad97b32cd580d0000000000000000000000000000000000000000000000004144b6a4eddf16aca8bcaac8fc5305804a7144eebc6be262337e89da7d918903555231a423eee084",
      ),
    ],
  },
  settlement: {
    ref: {
      chain: solana,
      hash: hashOf(
        "8uRCp3CjnvVSdQTfeiLaus8mMRYSng6otkhaR7SDiJUKugmjqW5zocNgfszsigUwpXx4G8pdUmp5XnkTsD3MDhE",
      ),
    },
    // Its log lines: two memos, the order's id and the request's.
    events: [
      "0xa8bcaac8fc5305804a7144eebc6be262337e89da7d918903555231a423eee084",
      "0x179354701178097e99610df125e2d466e09637d0f12194a9a9e3d38ed8301631",
    ].map((id) => ({
      emitter: accountRefSchema.parse(`${solana}:${memo}`),
      topics: ["log"],
      data: `Memo (len 66): "${id}"`,
    })),
  },
  wallet: accountRefSchema.parse(`${bsc}:0x48c732546476dacbbd688e3b2ce79ab22709221d`),
  amountIn: {
    asset: assetRefSchema.parse("eip155:56/erc20:0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d"),
    base: 0x41_44_b6_a4_ed_df_16_acn,
  },
  recipient: accountRefSchema.parse(`${solana}:ADcFfGPBHbdNY5yk1dP1vmoAz13TTfT4z3BbNooMHCy6`),
  minOut: {
    asset: assetRefSchema.parse(`${solana}/token:EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`),
    base: 4_646_595n,
  },
};

const refundedWallet = "0x9a444bbd7445d9243f9285d12524a19c4f3854a9";

/** The BSC deposit 0x0018...1d06 of USDT that Relay refunded, and the refund 0x9b79...5b34. */
export const recordedRefundCheck: SettlementCheck = {
  kind: "refund",
  deposit: {
    ref: {
      chain: bsc,
      hash: hashOf("0x001825aedff8d399a15eaab5ab09716ac203b990a261e5358e18ceb8ae291d06"),
    },
    events: [
      depositedOnBsc(
        "0x0000000000000000000000009a444bbd7445d9243f9285d12524a19c4f3854a900000000000000000000000055d398326f99059ff775485246999027b3197955000000000000000000000000000000000000000000000000114eb37716d305fa204060b69c43fa32b3a34f5ccb915d977a93f30648cb084db280dcf519096ee5",
      ),
    ],
  },
  settlement: {
    ref: {
      chain: bsc,
      hash: hashOf("0x9b79626d1690f2e447db3cb3fcb0899be04f5485bd2f952aa9b2f3a267995b34"),
    },
    events: [
      transferOn(bsc, "0x55d398326f99059ff775485246999027b3197955", {
        from: solver,
        to: refundedWallet,
        value: "0x0000000000000000000000000000000000000000000000001145aa2d572067b8",
      }),
    ],
  },
  wallet: accountRefSchema.parse(`${bsc}:${refundedWallet}`),
  amountIn: {
    asset: assetRefSchema.parse("eip155:56/erc20:0x55d398326f99059fF775485246999027B3197955"),
    base: 0x11_4e_b3_77_16_d3_05_fan,
  },
  recipient: accountRefSchema.parse(`${base}:${refundedWallet}`),
  minOut: {
    asset: assetRefSchema.parse("eip155:8453/erc20:0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"),
    base: 1n,
  },
};
