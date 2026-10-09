import { bscContract, bscToken, type Fork, withFork } from "@binference/chain-evm/fork";
import {
  type AccountRef,
  accountRefSchema,
  assetRefSchema,
  BinferenceError,
  type BuildRequest,
  type Clock,
  createSecret,
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
} from "viem";
import { describe, expect, it } from "vitest";
import { createOkxVenue } from "../okx-venue.js";

// The live half of the venue's tests: OKX quotes and encodes each trade on its API, which needs
// the owner's key, and the fork runs it. It runs only with a key in the environment, never in the
// repository: BINFERENCE_OKX_API_KEY, BINFERENCE_OKX_SECRET_KEY and BINFERENCE_OKX_PASSPHRASE.
// oxlint-disable-next-line node/no-process-env -- the owner's OKX key, read only here
const environment = process.env;
const {
  BINFERENCE_OKX_API_KEY: apiKey = "",
  BINFERENCE_OKX_SECRET_KEY: secretKey = "",
  BINFERENCE_OKX_PASSPHRASE: passphrase = "",
} = environment;
const liveTests = apiKey !== "" && secretKey !== "" && passphrase !== "";

const apiOrigin = "https://web3.okx.com";
const apiTimeoutMs = 20_000;
// The fork sits behind the head OKX quotes at, so the trades allow 1% slippage.
const keptBps = 9_900n;
// Rule 5: a trade call expires 60 s after its quote.
const quoteLifetimeMs = 60_000;
const router = bscContract("okx", "dex-router");
const approver = bscContract("okx", "token-approve");
const usdt = bscToken("USDT");
// OKX quotes for the wallet it is given; this one is impersonated on the fork with 10 BNB.
const wallet = getAddress("0x4b0897b0513fdc7c541b6d9d7e929c4e5364d2db");
const pancakeAbi = parseAbi([
  "function swapExactETHForTokens(uint256 amountOutMin, address[] path, address to, uint256 deadline) payable returns (uint256[] amounts)",
]);

// The OKX key signs with the wall clock: OKX refuses a stamp more than 30 s from its own.
const wallClock: Clock = {
  now: () => Date.now(),
  sleep: async () => Promise.resolve(),
};

// The fork suite reads OKX's API, and refuses every other host. It keeps the URLs it asked.
function okxHttp(asked: string[]): Http {
  return {
    async request(request) {
      asked.push(request.url);
      if (new URL(request.url).origin !== apiOrigin) {
        throw new BinferenceError({
          code: "fork.call_refused",
          message: "The fork suite reaches no host but OKX's API.",
        });
      }
      // oxlint-disable-next-line eslint/no-restricted-globals -- the fork suite reads OKX's API
      const response = await fetch(request.url, {
        method: request.method,
        ...(request.headers === undefined ? {} : { headers: request.headers }),
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
  readonly asked: readonly string[];
  readonly account: AccountRef;
  readonly contracts: Readonly<Record<string, AccountRef>>;
}

async function tradingOn(fork: Fork): Promise<Trading> {
  await fork.call("anvil_impersonateAccount", [wallet]);
  await fork.call("anvil_setCode", [wallet, "0x"]);
  await fork.call("anvil_setBalance", [wallet, toHex(10n * 10n ** 18n)]);
  const asked: string[] = [];
  const venue = createOkxVenue({
    http: okxHttp(asked),
    clock: wallClock,
    keys: {
      apiKey: createSecret(apiKey),
      secretKey: createSecret(secretKey),
      passphrase: createSecret(passphrase),
    },
    chains: [{ chain: fork.chain.ref, nativeAsset: fork.chain.nativeAsset }],
  });
  const accountOf = (address: Address): AccountRef =>
    accountRefSchema.parse(`${fork.chain.ref}:${address}`);
  const contracts = { "dex-router": accountOf(router), "token-approve": accountOf(approver) };
  return { fork, venue, asked, account: accountOf(wallet), contracts };
}

function valueOf<T>(result: Result<T, string>): T {
  if (!result.ok) {
    throw new Error(`Expected a success, got ${result.error}.`);
  }
  return result.value;
}

function termsOf(request: QuoteRequest, quote: VenueQuote): BuildRequest {
  const floor = (quote.expectedOut.base * keptBps + 9_999n) / 10_000n;
  const deadlineMs = Date.now() + quoteLifetimeMs;
  return { ...request, quote, minOut: { asset: request.assetOut, base: floor }, deadlineMs };
}

function callOf(draft: TxDraft): EvmDraftCall {
  return valueOf(decodeEvmDraft(draft));
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
  expect(effect.value.recipient).toBe(trading.account);
  expect(effect.value.amountIn).toStrictEqual(terms.amountIn);
  expect(effect.value.minOut.base).toBeGreaterThanOrEqual(terms.minOut.base);
  expect(effect.value.deadlineMs).toBeLessThanOrEqual(terms.deadlineMs);
  return effect.value;
}

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

async function usdtOf(fork: Fork): Promise<bigint> {
  return fork.client.readContract({
    address: usdt,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [wallet],
  });
}

function outcomeText(trading: Trading, quote: VenueQuote, received: bigint): string {
  const paths = trading.asked.map((url) => new URL(url).pathname.split("/").at(-1)).join(" ");
  const out = `quoted ${String(quote.expectedOut.base)}, received ${String(received)}`;
  return `block ${String(trading.fork.block)}: ${out}, route ${String(quote.route)}, asked ${paths}`;
}

describe.runIf(liveTests)("okx on a BSC fork", () => {
  it("buys USDT with BNB through OKX's router at the pinned block", async ({ signal, annotate }) =>
    withFork(signal, async (fork) => {
      const trading = await tradingOn(fork);
      const request: QuoteRequest = {
        wallet: trading.account,
        amountIn: { asset: fork.chain.nativeAsset, base: 10n ** 17n },
        assetOut: assetRefSchema.parse(`${fork.chain.ref}/erc20:${usdt}`),
        contracts: trading.contracts,
      };
      const quote = valueOf(await trading.venue.quote(request, { signal }));
      const terms = termsOf(request, quote);
      const drafts = await trading.venue.build(terms, { signal });
      expect(drafts).toHaveLength(1);
      const effect = tradeEffect(trading, terms, drafts);

      const before = await usdtOf(fork);
      const receipts = await sendAll(fork, drafts);
      const received = (await usdtOf(fork)) - before;

      expect(receipts.map((receipt) => receipt.status)).toStrictEqual(["success"]);
      expect(received).toBeGreaterThanOrEqual(effect.minOut.base);
      await annotate(outcomeText(trading, quote, received));
    }));

  it("sells USDT for BNB through OKX's router, after an exact approval", async ({
    signal,
    annotate,
  }) =>
    withFork(signal, async (fork) => {
      const trading = await tradingOn(fork);
      const amountIn = 20n * 10n ** 18n;
      const data = encodeFunctionData({
        abi: pancakeAbi,
        functionName: "swapExactETHForTokens",
        args: [
          amountIn,
          [bscToken("WBNB"), usdt],
          wallet,
          BigInt(Math.floor(Date.now() / 1000) + 300),
        ],
      });
      await fork.send({
        from: wallet,
        to: bscContract("pancakeswap", "v2-router"),
        value: 10n ** 18n,
        data,
      });
      const request: QuoteRequest = {
        wallet: trading.account,
        amountIn: {
          asset: assetRefSchema.parse(`${fork.chain.ref}/erc20:${usdt}`),
          base: amountIn,
        },
        assetOut: fork.chain.nativeAsset,
        contracts: trading.contracts,
      };
      const quote = valueOf(await trading.venue.quote(request, { signal }));
      const terms = termsOf(request, quote);
      const drafts = await trading.venue.build(terms, { signal });
      expect(drafts.map(callOf)).toMatchObject([
        {
          to: usdt,
          value: 0n,
          data: encodeFunctionData({
            abi: erc20Abi,
            functionName: "approve",
            args: [approver, amountIn],
          }),
        },
        { to: router, value: 0n },
      ]);
      const effect = tradeEffect(trading, terms, drafts);

      const before = await fork.client.getBalance({ address: wallet });
      const usdtBefore = await usdtOf(fork);
      const receipts = await sendAll(fork, drafts);
      const gas = receipts.reduce(
        (total, receipt) => total + receipt.gasUsed * receipt.effectiveGasPrice,
        0n,
      );
      const received = (await fork.client.getBalance({ address: wallet })) - before + gas;

      expect(receipts.map((receipt) => receipt.status)).toStrictEqual(["success", "success"]);
      expect(usdtBefore - (await usdtOf(fork))).toBe(amountIn);
      expect(received).toBeGreaterThanOrEqual(effect.minOut.base);
      await annotate(outcomeText(trading, quote, received));
    }));
});
