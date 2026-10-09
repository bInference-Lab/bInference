import {
  type AccountRef,
  accountRefSchema,
  type AssetRef,
  type AssetTransfer,
  type SimulatedStep,
  type TxSimulator,
  assetRefSchema,
} from "@binference/chain";
import { applyBps, bpsSchema } from "@binference/core";
import { testCoin, testToken } from "../intents/test-intents.js";
import { testAccount } from "../operations/test-engine.js";
import type { TradeQuote } from "../venues/venue-host.js";
import type { RiskSubject } from "./risk-assessment.js";

/** How the fake chain's unknown token behaves in a test: its taxes and the legs it refuses. */
export interface TokenModel {
  readonly buyTaxBps?: number;
  readonly transferTaxBps?: number;
  readonly sellTaxBps?: number;
  /** A transfer between two holders reverts. */
  readonly blocksTransfers?: boolean;
  /** A sale reverts. */
  readonly blocksSales?: boolean;
  /** A buy reverts. */
  readonly blocksBuys?: boolean;
}

/** A token the fake chain's registry does not list. */
export const unknownToken: AssetRef = assetRefSchema.parse("fake:1/token:0x0000000f");
/** The fake chain's router: the pool every fake swap trades with. */
const pool = accountRefSchema.parse("fake:1:0x0000000b");
const feeWallet = accountRefSchema.parse("fake:1:0x000000fe");
const tokenContract = accountRefSchema.parse("fake:1:0x0000000f");
const reverted: SimulatedStep = { status: "reverted", gasUsed: 0n, transfers: [], approvals: [] };

function moved(transfers: readonly AssetTransfer[]): SimulatedStep {
  return { status: "success", gasUsed: 50_000n, transfers, approvals: [] };
}

function taxOf(base: bigint, bps = 0): bigint {
  return applyBps(base, bpsSchema.parse(bps), "down");
}

// A tax the token takes from `from`: what reaches `to`, then the fee wallet's cut.
function taxed(
  { from, to, base }: { readonly from: AccountRef; readonly to: AccountRef; readonly base: bigint },
  bps?: number,
): readonly AssetTransfer[] {
  const fee = taxOf(base, bps);
  return [
    { from, to, amount: { asset: unknownToken, base: base - fee } },
    ...(fee > 0n ? [{ from, to: feeWallet, amount: { asset: unknownToken, base: fee } }] : []),
  ];
}

// A fake swap at the fake venue's 2 to 1 rate: `swap,<recipient>,<in>,<asset in>,…`.
interface SwapCall {
  readonly from: AccountRef;
  readonly words: readonly string[];
  /** The coin the buyer was given for the run: a fresh buyer holds nothing on the chain. */
  readonly coin: bigint;
}

function swapStep({ from, words, coin }: SwapCall, model: TokenModel): SimulatedStep {
  const [recipientAddress = "", inBase = "0", inAsset = ""] = words;
  const recipient = accountRefSchema.parse(`fake:1:${recipientAddress}`);
  const amountIn = BigInt(inBase);
  const out = amountIn * 2n;
  if (inAsset === unknownToken) {
    return model.blocksSales === true
      ? reverted
      : moved([
          ...taxed({ from, to: pool, base: amountIn }, model.sellTaxBps),
          // The token's contract swaps its fees during a sale: never the seller's tokens.
          { from: tokenContract, to: pool, amount: { asset: unknownToken, base: 7n } },
          { from: pool, to: recipient, amount: { asset: testCoin, base: out } },
        ]);
  }
  return model.blocksBuys === true || coin < amountIn
    ? reverted
    : moved([
        { from, to: pool, amount: { asset: testCoin, base: amountIn } },
        ...taxed({ from: pool, to: recipient, base: out }, model.buyTaxBps),
      ]);
}

function transferStep(
  from: AccountRef,
  words: readonly string[],
  model: TokenModel,
): SimulatedStep {
  const [toAddress = "", base = "0"] = words;
  const to = accountRefSchema.parse(`fake:1:${toAddress}`);
  return model.blocksTransfers === true
    ? reverted
    : moved(taxed({ from, to, base: BigInt(base) }, model.transferTaxBps));
}

/**
 * A simulator of the fake chain for the round trip: it reads the fake venue's swaps, approvals
 * and the fake family's token transfers of {@link unknownToken}, and moves what the model says.
 * A buy reverts unless the run's balances give its sender the coin it pays.
 */
export function createTokenModelSimulator(model: TokenModel): TxSimulator & {
  readonly runs: () => number;
} {
  let count = 0;
  return {
    async simulate(drafts, { signal, balances = [] }) {
      signal.throwIfAborted();
      count += 1;
      const coin = balances.find((amount) => amount.asset === testCoin)?.base ?? 0n;
      return await Promise.resolve(
        drafts.map((draft) => {
          const [kind = "", ...words] = (draft.payload.split("|")[2] ?? "").split(",");
          if (kind === "swap") {
            return swapStep({ from: draft.from, words, coin }, model);
          }
          return kind === "transfer" ? transferStep(draft.from, words, model) : moved([]);
        }),
      );
    },
    runs: () => count,
  };
}

/** A quote of 1 coin for the unknown token on the fake venue, for the test wallet. */
export function unknownTokenQuote(nowMs: number): TradeQuote {
  return {
    trade: {
      venue: "fake-swap",
      wallet: testAccount,
      amountIn: { asset: testCoin, base: 10n ** 18n },
      assetOut: unknownToken,
      maxSlippageBps: bpsSchema.parse(100),
    },
    quote: {
      expectedOut: { asset: unknownToken, base: 2n * 10n ** 18n },
      priceImpactBps: bpsSchema.parse(10),
    },
    quotedAtMs: nowMs,
  };
}

/** A risk subject with the default limits: a tax up to 10% and $10,000 of liquidity. */
export function riskSubjectOf(quoted: TradeQuote): RiskSubject {
  return {
    quoted,
    limits: { maxTaxBps: bpsSchema.parse(1_000), liquidityFloorUsdMicros: 10_000_000_000n },
  };
}

/** A quote of 1 coin for the registry's token, which needs no risk source. */
export function listedTokenQuote(nowMs: number): TradeQuote {
  const quoted = unknownTokenQuote(nowMs);
  return { ...quoted, trade: { ...quoted.trade, assetOut: testToken } };
}
