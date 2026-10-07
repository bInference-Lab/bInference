import { bscContract, bscToken, type Fork, withFork } from "@binference/chain-evm/fork";
import {
  type AccountRef,
  accountRefParts,
  accountRefSchema,
  assetRefSchema,
  BinferenceError,
  type BuildRequest,
  type DecodedEffect,
  type Http,
  type QuoteRequest,
  type Result,
  type TxDraft,
  type Venue,
  type VenueQuote,
} from "@binference/plugin-sdk";
import { decodeEvmDraft, type EvmDraftCall } from "@binference/plugin-sdk/evm";
import {
  type Address,
  encodeFunctionData,
  erc20Abi,
  getAddress,
  parseAbi,
  toHex,
  type TransactionReceipt,
  zeroAddress,
} from "viem";
import { describe, expect, it } from "vitest";
import { createKyberswapVenue } from "../kyberswap-venue.js";
import { recordedWallet } from "../testing/recorded-terms.js";

const apiOrigin = "https://aggregator-api.kyberswap.com";
const apiTimeoutMs = 20_000;
// The fork sits behind the head KyberSwap quotes at, so the trades allow 1% slippage.
const keptBps = 9_900n;
// Rule 5: a trade call expires 60 s after its quote.
const quoteLifetimeMs = 60_000;
const router = bscContract("kyberswap", "meta-aggregation-router-v2");
const executor = bscContract("kyberswap", "aggregation-executor-proxy");
const usdt = bscToken("USDT");
const wallet = getAddress(accountRefParts(recordedWallet).address);
const pancakeAbi = parseAbi([
  "function swapExactETHForTokens(uint256 amountOutMin, address[] path, address to, uint256 deadline) payable returns (uint256[] amounts)",
]);

// The fork suite reads KyberSwap's public API, and refuses every other host. It keeps the URLs it
// asked, for the test report.
function kyberswapHttp(asked: string[]): Http {
  return {
    async request(request) {
      asked.push(request.url);
      if (new URL(request.url).origin !== apiOrigin) {
        throw new BinferenceError({
          code: "fork.call_refused",
          message: "The fork suite reaches no host but KyberSwap's API.",
        });
      }
      // oxlint-disable-next-line eslint/no-restricted-globals -- the fork suite reads KyberSwap's public API
      const response = await fetch(request.url, {
        method: request.method,
        ...(request.headers === undefined ? {} : { headers: request.headers }),
        ...(request.body === undefined ? {} : { body: request.body }),
        signal: AbortSignal.any([request.signal, AbortSignal.timeout(apiTimeoutMs)]),
      });
      const headers = Object.fromEntries(response.headers);
      return { status: response.status, headers, body: await response.text() };
    },
  };
}

interface Trading {
  readonly fork: Fork;
  readonly venue: Venue;
  /** Every URL the venue asked KyberSwap's API, oldest first. */
  readonly asked: readonly string[];
  readonly contracts: Readonly<Record<string, AccountRef>>;
}

function accountOn(fork: Fork, address: Address): AccountRef {
  return accountRefSchema.parse(`${fork.chain.ref}:${address}`);
}

// KyberSwap refuses anvil's public test accounts, so the trades come from the recorded wallet,
// impersonated on the fork with 10 BNB.
async function tradingOn(fork: Fork): Promise<Trading> {
  await fork.call("anvil_impersonateAccount", [wallet]);
  await fork.call("anvil_setCode", [wallet, "0x"]);
  await fork.call("anvil_setBalance", [wallet, toHex(10n * 10n ** 18n)]);
  const asked: string[] = [];
  const venue = createKyberswapVenue({
    http: kyberswapHttp(asked),
    clientId: "binference",
    chains: [{ chain: fork.chain.ref, nativeAsset: fork.chain.nativeAsset, allowedHooks: [] }],
  });
  const contracts = {
    "meta-aggregation-router-v2": accountOn(fork, router),
    "aggregation-executor-proxy": accountOn(fork, executor),
  };
  return { fork, venue, asked, contracts };
}

function valueOf<T>(result: Result<T, string>): T {
  if (!result.ok) {
    throw new Error(`Expected a success, got ${result.error}.`);
  }
  return result.value;
}

// The terms the venue host sets after a quote: the slippage floor rounded up, 60 s to run.
function termsOf(request: QuoteRequest, quote: VenueQuote): BuildRequest {
  const floor = (quote.expectedOut.base * keptBps + 9_999n) / 10_000n;
  const deadlineMs = Date.now() + quoteLifetimeMs;
  return { ...request, quote, minOut: { asset: request.assetOut, base: floor }, deadlineMs };
}

function callOf(draft: TxDraft): EvmDraftCall {
  const call = decodeEvmDraft(draft);
  if (!call.ok) {
    throw new Error("A draft is no EVM call.");
  }
  return call.value;
}

// The hooks the quoted route passes through, as its summary names them.
function hooksIn(quote: VenueQuote): readonly string[] {
  return [...String(quote.route).matchAll(/"hookAddress":"(0x[0-9a-fA-F]{40})"/g)].map((match) =>
    getAddress(match[1] ?? zeroAddress),
  );
}

// The checks the venue host makes, from the drafts' bytes: every step from the wallet, the trade
// call to the registry's router paying the wallet the exact input's output, by the deadline.
function tradeEffect(
  trading: Trading,
  terms: BuildRequest,
  drafts: readonly TxDraft[],
): DecodedEffect {
  const trade = drafts.at(-1);
  const effect = trade === undefined ? undefined : trading.venue.decode(trade);
  if (trade === undefined || effect?.ok !== true) {
    throw new Error("The build holds no trade call the venue reads.");
  }
  expect(drafts.map((draft) => callOf(draft).from)).toStrictEqual(drafts.map(() => wallet));
  expect(callOf(trade).to).toBe(router);
  expect(effect.value.recipient).toBe(recordedWallet);
  expect(effect.value.amountIn).toStrictEqual(terms.amountIn);
  expect(effect.value.minOut.asset).toBe(terms.assetOut);
  expect(effect.value.minOut.base).toBeGreaterThanOrEqual(terms.minOut.base);
  expect(effect.value.deadlineMs).toBeLessThanOrEqual(terms.deadlineMs);
  return effect.value;
}

// One draft after another: a sale's approval lands before its trade call.
async function sendAll(
  fork: Fork,
  drafts: readonly TxDraft[],
): Promise<readonly TransactionReceipt[]> {
  return drafts.reduce<Promise<readonly TransactionReceipt[]>>(async (sending, draft) => {
    const sent = await sending;
    const { from, to, value, data } = callOf(draft);
    return [...sent, await fork.send({ from, to, value, data })];
  }, Promise.resolve([]));
}

interface Outcome {
  readonly trading: Trading;
  readonly quote: VenueQuote;
  readonly received: bigint;
  readonly receipts: readonly TransactionReceipt[];
}

// What a trade did on the fork, for the test report.
function outcomeText({ trading, quote, received, receipts }: Outcome): string {
  const gas = receipts.map((receipt) => String(receipt.gasUsed)).join(" + ");
  const out = `quoted ${String(quote.expectedOut.base)}, received ${String(received)}`;
  const pools = [...String(quote.route).matchAll(/"exchange":"([^"]+)"/g)].map((match) => match[1]);
  const excluded = trading.asked.map((url) => new URL(url).searchParams.get("excludedSources"));
  const asks = `asked ${JSON.stringify(excluded)} as excluded sources`;
  return `block ${String(trading.fork.block)}: ${out}, gas ${gas}, pools ${pools.join(" ")}, ${asks}`;
}

function gasPaid(receipts: readonly TransactionReceipt[]): bigint {
  return receipts.reduce(
    (total, receipt) => total + receipt.gasUsed * receipt.effectiveGasPrice,
    0n,
  );
}

async function usdtOf(fork: Fork): Promise<bigint> {
  return fork.client.readContract({
    address: usdt,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [wallet],
  });
}

// USDT for the sale, bought through PancakeSwap's v2 router so the sale stands on its own.
async function holdUsdt(fork: Fork, amount: bigint): Promise<void> {
  const data = encodeFunctionData({
    abi: pancakeAbi,
    functionName: "swapExactETHForTokens",
    args: [amount, [bscToken("WBNB"), usdt], wallet, BigInt(Math.floor(Date.now() / 1000) + 300)],
  });
  const pancakeRouter = bscContract("pancakeswap", "v2-router");
  await fork.send({ from: wallet, to: pancakeRouter, value: 10n ** 18n, data });
}

describe("kyberswap on a BSC fork", () => {
  it("buys USDT with BNB through KyberSwap's router at the pinned block", async ({
    signal,
    annotate,
  }) =>
    withFork(signal, async (fork) => {
      const trading = await tradingOn(fork);
      const request: QuoteRequest = {
        wallet: recordedWallet,
        amountIn: { asset: fork.chain.nativeAsset, base: 10n ** 17n },
        assetOut: assetRefSchema.parse(`${fork.chain.ref}/erc20:${usdt}`),
        contracts: trading.contracts,
      };
      const quote = valueOf(await trading.venue.quote(request, { signal }));
      expect(hooksIn(quote).every((hook) => hook === zeroAddress)).toBe(true);
      const terms = termsOf(request, quote);
      const drafts = await trading.venue.build(terms, { signal });
      expect(drafts).toHaveLength(1);
      const effect = tradeEffect(trading, terms, drafts);

      const before = await usdtOf(fork);
      const receipts = await sendAll(fork, drafts);
      const received = (await usdtOf(fork)) - before;

      expect(receipts.map((receipt) => receipt.status)).toStrictEqual(["success"]);
      expect(received).toBeGreaterThanOrEqual(effect.minOut.base);
      await annotate(outcomeText({ trading, quote, received, receipts }));
    }));

  it("sells USDT for BNB through KyberSwap's router, after an exact approval", async ({
    signal,
    annotate,
  }) =>
    withFork(signal, async (fork) => {
      const trading = await tradingOn(fork);
      await holdUsdt(fork, 20n * 10n ** 18n);
      const amountIn = 20n * 10n ** 18n;
      const request: QuoteRequest = {
        wallet: recordedWallet,
        amountIn: {
          asset: assetRefSchema.parse(`${fork.chain.ref}/erc20:${usdt}`),
          base: amountIn,
        },
        assetOut: fork.chain.nativeAsset,
        contracts: trading.contracts,
      };
      const quote = valueOf(await trading.venue.quote(request, { signal }));
      expect(hooksIn(quote).every((hook) => hook === zeroAddress)).toBe(true);
      const terms = termsOf(request, quote);
      const drafts = await trading.venue.build(terms, { signal });
      expect(drafts.map(callOf)).toMatchObject([
        {
          to: usdt,
          value: 0n,
          data: encodeFunctionData({
            abi: erc20Abi,
            functionName: "approve",
            args: [router, amountIn],
          }),
        },
        { to: router, value: 0n },
      ]);
      const effect = tradeEffect(trading, terms, drafts);

      const before = await fork.client.getBalance({ address: wallet });
      const usdtBefore = await usdtOf(fork);
      const receipts = await sendAll(fork, drafts);
      const after = await fork.client.getBalance({ address: wallet });
      const received = after - before + gasPaid(receipts);

      expect(receipts.map((receipt) => receipt.status)).toStrictEqual(["success", "success"]);
      expect(usdtBefore - (await usdtOf(fork))).toBe(amountIn);
      expect(received).toBeGreaterThanOrEqual(effect.minOut.base);
      await annotate(outcomeText({ trading, quote, received, receipts }));
    }));
});
