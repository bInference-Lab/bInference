import { bscContract, bscToken, type Fork, withFork } from "@binference/chain-evm/fork";
import {
  type AccountRef,
  accountRefSchema,
  type AssetRef,
  assetRefSchema,
  type LaunchpadVenue,
  type QuoteRequest,
  type TxDraft,
  type VenueQuote,
} from "@binference/plugin-sdk";
import { decodeEvmDraft } from "@binference/plugin-sdk/evm";
import { hostBuildRequest } from "@binference/plugin-sdk/testing";
import {
  type Address,
  encodeFunctionData,
  erc20Abi,
  getAddress,
  parseAbi,
  parseAbiItem,
  parseEther,
  type TransactionReceipt,
  zeroAddress,
} from "viem";
import { describe, expect, it } from "vitest";
import { createFlapVenue } from "../flap-venue.js";

const portal = bscContract("flap", "portal");
const usdt = bscToken("USDT");
// The fork's trades allow 1% below the quote, as an agent's slippage would.
const keepBps = 9_900n;
const quoteLifetimeMs = 60_000;
// Tokens bought on the Portal in the last 600 blocks before the fork, about four minutes.
const scannedBlocks = 600n;
const tradable = 1;
// The newest tokens bought, whose state the test reads to pick one.
const candidates = 24;
// Curve tokens seen trading on 2026-10-12, read after the newest ones: few curve tokens ever reach
// their pool, so these stay on their curves while the newest ones trade against other tokens.
const seenOnCurves: readonly Address[] = [
  "0x7270576A906EAe19a995273695ec223056bD7777",
  "0x25720CD452c2A9AEe872C3798B4384e801587777",
  "0x649216A8Bf562728fB5059a6BF842f7300C77777",
  "0x9a581e9C3F51847A0d74D3493888956133878888",
  "0x8E32c66E14ED7620F5CC6C18400ea167b8908888",
];
// A buy of 0.05 BNB or 5 USDT moves no curve below 70% of the way to its pool.
const maxProgress = parseEther("0.7");
const bought = parseAbiItem(
  "event TokenBought(uint256 ts, address token, address buyer, uint256 amount, uint256 eth, uint256 fee, uint256 postPrice)",
);
// The Portal's own view of a token, read here apart from the venue's code.
const stateAbi = parseAbi([
  "struct TokenStateV8Safe { uint8 status; uint256 reserve; uint256 circulatingSupply; uint256 price; uint8 tokenVersion; uint256 r; uint256 h; uint256 k; uint256 dexSupplyThresh; address quoteTokenAddress; bool nativeToQuoteSwapEnabled; bytes32 extensionID; uint256 buyTaxRate; uint256 sellTaxRate; address pool; uint256 progress; uint8 lpFeeProfile; uint8 dexId; }",
  "function getTokenV8Safe(address token) view returns (TokenStateV8Safe state)",
]);
const pancakeAbi = parseAbi([
  "function swapExactETHForTokens(uint256 amountOutMin, address[] path, address to, uint256 deadline) payable returns (uint256[] amounts)",
]);

interface CurveToken {
  readonly address: Address;
  readonly quoteToken: Address;
  readonly buyTaxBps: bigint;
  readonly sellTaxBps: bigint;
}

interface Trading {
  readonly fork: Fork;
  readonly signal: AbortSignal;
  readonly venue: LaunchpadVenue;
  readonly wallet: AccountRef;
  readonly contracts: Readonly<Record<string, AccountRef>>;
}

function tradingOn(fork: Fork, signal: AbortSignal): Trading {
  const erc20 = (address: Address): AssetRef =>
    assetRefSchema.parse(`${fork.chain.ref}/erc20:${address}`);
  const venue = createFlapVenue({
    chains: [
      {
        chain: fork.chain.ref,
        nativeAsset: fork.chain.nativeAsset,
        quoteTokens: [erc20(usdt), erc20(bscToken("USD1"))],
        rpc: fork.rpc,
      },
    ],
  });
  const account = (address: Address) => accountRefSchema.parse(`${fork.chain.ref}:${address}`);
  const contracts = { portal: account(portal) };
  return { fork, signal, venue, wallet: account(fork.account), contracts };
}

async function stateOf(fork: Fork, token: Address) {
  return fork.client.readContract({
    address: portal,
    abi: stateAbi,
    functionName: "getTokenV8Safe",
    args: [token],
  });
}

// The tokens bought on the Portal in the blocks before the fork, newest first, each once.
async function boughtTokens(fork: Fork): Promise<readonly Address[]> {
  const logs = await fork.scanLogs({
    address: portal,
    event: bought,
    fromBlock: fork.block - scannedBlocks + 1n,
    toBlock: fork.block,
  });
  return [...new Set(logs.map((log) => getAddress(log.args.token)).toReversed())];
}

// The newest curve token trading against `quoteToken` with room left on its curve, and with a tax
// when `taxed`, else one seen on its curve before. Finding none fails the test.
async function curveToken(
  fork: Fork,
  want: { readonly quoteToken: Address; readonly taxed?: boolean },
): Promise<CurveToken> {
  const newest = (await boughtTokens(fork)).slice(0, candidates);
  const addresses = [...new Set([...newest, ...seenOnCurves])];
  const states = await Promise.all(addresses.map(async (address) => stateOf(fork, address)));
  const index = states.findIndex(
    (state) =>
      state.status === tradable &&
      state.quoteTokenAddress === want.quoteToken &&
      state.progress < maxProgress &&
      (want.taxed === undefined || state.buyTaxRate > 0n === want.taxed),
  );
  const [address, state] = [addresses[index], states[index]];
  if (address === undefined || state === undefined) {
    throw new Error(`No curve token against ${want.quoteToken} was bought in the scanned blocks.`);
  }
  return {
    address,
    quoteToken: state.quoteTokenAddress,
    buyTaxBps: state.buyTaxRate,
    sellTaxBps: state.sellTaxRate,
  };
}

async function quoteOf(trading: Trading, request: QuoteRequest): Promise<VenueQuote> {
  const quote = await trading.venue.quote(request, { signal: trading.signal });
  if (!quote.ok) {
    throw new Error(`Flap gave no quote: ${quote.error}.`);
  }
  return quote.value;
}

function lastOf(drafts: readonly TxDraft[]): TxDraft {
  const last = drafts.at(-1);
  if (last === undefined) {
    throw new Error("The venue built nothing.");
  }
  return last;
}

function callOf(draft: TxDraft) {
  const call = decodeEvmDraft(draft);
  if (!call.ok) {
    throw new Error("A draft is no EVM call.");
  }
  return call.value;
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

const gasPaid = (receipts: readonly TransactionReceipt[]): bigint =>
  receipts.reduce((total, receipt) => total + receipt.gasUsed * receipt.effectiveGasPrice, 0n);

async function balanceOf(fork: Fork, asset: Address): Promise<bigint> {
  return asset === zeroAddress
    ? fork.client.getBalance({ address: fork.account })
    : fork.client.readContract({
        address: asset,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [fork.account],
      });
}

interface Trade {
  readonly amountIn: bigint;
  readonly input: Address;
  readonly output: Address;
}

/** What a trade on the fork did: its quote, what the wallet received, and the build's steps. */
interface Traded {
  readonly quote: VenueQuote;
  readonly received: bigint;
  readonly minOut: bigint;
  readonly steps: readonly TransactionReceipt[];
}

// Quotes, builds and sends one trade through the venue, as the venue host would ask for it.
async function trade(trading: Trading, asked: Trade): Promise<Traded> {
  const { fork, venue, wallet, contracts } = trading;
  const asset = (address: Address): AssetRef =>
    address === zeroAddress
      ? fork.chain.nativeAsset
      : assetRefSchema.parse(`${fork.chain.ref}/erc20:${address}`);
  const request: QuoteRequest = {
    wallet,
    amountIn: { asset: asset(asked.input), base: asked.amountIn },
    assetOut: asset(asked.output),
    contracts,
  };
  const quote = await quoteOf(trading, request);
  const terms = hostBuildRequest(request, quote, {
    deadlineMs: Date.now() + quoteLifetimeMs,
    keepBps,
  });
  const drafts = await venue.build(terms, { signal: trading.signal });
  expect(venue.decode(lastOf(drafts))).toStrictEqual({
    ok: true,
    value: { recipient: wallet, amountIn: request.amountIn, minOut: terms.minOut },
  });
  const before = await balanceOf(fork, asked.output);
  const steps = await sendAll(fork, drafts);
  const gas = asked.output === zeroAddress ? gasPaid(steps) : 0n;
  const received = (await balanceOf(fork, asked.output)) - before + gas;
  return { quote, received, minOut: terms.minOut.base, steps };
}

// USDT for a buy, bought through PancakeSwap's v2 router so the test stands on its own.
async function holdUsdt(fork: Fork): Promise<void> {
  const data = encodeFunctionData({
    abi: pancakeAbi,
    functionName: "swapExactETHForTokens",
    args: [0n, [bscToken("WBNB"), usdt], fork.account, BigInt(Math.floor(Date.now() / 1000) + 300)],
  });
  await fork.send({
    from: fork.account,
    to: bscContract("pancakeswap", "v2-router"),
    value: parseEther("0.1"),
    data,
  });
}

function report(fork: Fork, token: Address, traded: readonly Traded[]): string {
  const legs = traded.map(
    ({ quote, received, steps }) =>
      `quoted ${String(quote.expectedOut.base)} at ${String(quote.priceImpactBps)} bp impact, tax ${String(quote.taxBps ?? 0)} bp, received ${String(received)} in ${String(steps.length)} step(s)`,
  );
  return `block ${String(fork.block)}, token ${token}: ${legs.join("; ")}`;
}

describe("flap on a BSC fork", () => {
  it("buys a taxed BNB curve token on the Portal and sells it back, its tax in each quote", async ({
    signal,
    annotate,
  }) =>
    withFork(signal, async (fork) => {
      const trading = tradingOn(fork, signal);
      const token = await curveToken(fork, { quoteToken: zeroAddress, taxed: true });
      const holding = await trading.venue.curve(
        {
          token: assetRefSchema.parse(`${fork.chain.ref}/erc20:${token.address}`),
          contracts: trading.contracts,
        },
        { signal },
      );
      expect(holding).toStrictEqual({ onCurve: true, quoteAsset: fork.chain.nativeAsset });

      const buy = await trade(trading, {
        amountIn: parseEther("0.05"),
        input: zeroAddress,
        output: token.address,
      });
      expect(buy.steps.map((step) => step.status)).toStrictEqual(["success"]);
      expect(buy.quote.taxBps).toBe(Number(token.buyTaxBps));
      expect(buy.received).toBeGreaterThanOrEqual(buy.minOut);

      const sale = await trade(trading, {
        amountIn: buy.received,
        input: token.address,
        output: zeroAddress,
      });
      expect(sale.steps.map((step) => step.status)).toStrictEqual(["success", "success"]);
      expect(sale.quote.taxBps).toBe(Number(token.sellTaxBps));
      expect(sale.received).toBeGreaterThanOrEqual(sale.minOut);
      expect(await balanceOf(fork, token.address)).toBe(0n);
      await annotate(report(fork, token.address, [buy, sale]));
    }));

  it("buys a USDT curve token with USDT and sells it back for USDT", async ({ signal, annotate }) =>
    withFork(signal, async (fork) => {
      const trading = tradingOn(fork, signal);
      const token = await curveToken(fork, { quoteToken: usdt });
      await holdUsdt(fork);

      const buy = await trade(trading, {
        amountIn: parseEther("5"),
        input: usdt,
        output: token.address,
      });
      expect(buy.steps.map((step) => step.status)).toStrictEqual(["success", "success"]);
      expect(buy.received).toBeGreaterThanOrEqual(buy.minOut);

      const sale = await trade(trading, {
        amountIn: buy.received,
        input: token.address,
        output: usdt,
      });
      expect(sale.steps.map((step) => step.status)).toStrictEqual(["success", "success"]);
      expect(sale.received).toBeGreaterThanOrEqual(sale.minOut);
      await annotate(report(fork, token.address, [buy, sale]));
    }));

  it("answers a token that graduated to a pool as off its curve and quotes it no route", async ({
    signal,
  }) =>
    withFork(signal, async (fork) => {
      const trading = tradingOn(fork, signal);
      // Graduated to a PancakeSwap pool at block 127,130,636, read on 2026-10-12.
      const graduated: Address = "0x8344A74ABf9e31bFC9A4d0a2443826C768647777";
      const token = assetRefSchema.parse(`${fork.chain.ref}/erc20:${graduated}`);
      expect((await stateOf(fork, graduated)).status).toBe(4);
      expect(
        await trading.venue.curve({ token, contracts: trading.contracts }, { signal }),
      ).toStrictEqual({ onCurve: false });
      const request = {
        wallet: trading.wallet,
        amountIn: { asset: fork.chain.nativeAsset, base: parseEther("0.05") },
        assetOut: token,
        contracts: trading.contracts,
      };
      expect(await trading.venue.quote(request, { signal })).toStrictEqual({
        ok: false,
        error: "no_route",
      });
    }));
});
