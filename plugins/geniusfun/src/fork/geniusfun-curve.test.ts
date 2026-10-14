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
import { hostBuildRequest, successOf } from "@binference/plugin-sdk/testing";
import {
  type Address,
  decodeFunctionResult,
  encodeFunctionData,
  erc20Abi,
  getAddress,
  type Hex,
  parseAbi,
  parseEther,
  type TransactionReceipt,
  toHex,
  zeroAddress,
} from "viem";
import { describe, expect, it } from "vitest";
import { createGeniusfunVenue } from "../geniusfun-venue.js";

const usdt = bscToken("USDT");
const factoryM42 = bscContract("geniusfun", "factory-m4-2");
const registry: Readonly<Record<string, Address>> = {
  "factory-m4-2": factoryM42,
  "factory-m4-1": bscContract("geniusfun", "factory-m4-1"),
};
// The fork's trades allow 1% below the quote, as an agent's slippage would.
const keepBps = 9_900n;
// Tokens seen on their curves against BNB on 2026-10-14, by stack: few reach their pool, so these
// stay on their curves. The first that still trades there is traded.
const seenOnCurves: Readonly<Record<string, readonly Address[]>> = {
  "m4.2": [
    "0x7D227534c39C41033Af86DBC8aDE1BF8D68b0157",
    "0x14ED581698DeDDDdaee3629C877f072ba0a46666",
    "0xe208E22C281353Cf7de90D51C53cA913a0B66666",
  ],
  "m4.1": [
    "0x4b8f01455c13e872d6910f728cF953db87ed68Bc",
    "0x7F7bA07dd5e5d3C5b0A0Ea94DF96AEAdADC845f7",
    "0x3Cf759c4AeecE7BC0aA3A16f09D833d642BcAc50",
  ],
};
// The curve's own calls, read here apart from the venue's code.
const curveAbi = parseAbi([
  "function buy(uint256 quoteIn, uint256 minTokensOut, address recipient) payable returns (uint256 tokensOut)",
  "function sell(uint256 tokensIn, uint256 minQuoteOut, address recipient) returns (uint256 quoteOut)",
  "function currentSnipeTaxBps(address recipient) view returns (uint256)",
  "function getReserves() view returns (uint256 quoteReserve, uint256 tokenReserve)",
  "function sellableTokens() view returns (uint256)",
]);
// The launch call the fork's own launches use, with the terms the stack's factory quotes.
const factoryAbi = parseAbi([
  "struct Socials { string twitter; string telegram; string discord; string website; string farcaster; }",
  "struct TokenParams { string name; string symbol; string logo; string description; Socials socials; address creatorFeeRecipient; uint16 creatorTaxBps; bool buybackEnabled; bytes32 expectedEconomics; bytes32 salt; }",
  "function launchToken(TokenParams params, uint256 configId, address pairToken, bool toFoundation, address[] snipeTaxExemptions) payable returns (address token, address curve)",
  "function previewLaunchEconomics(uint256 launchConfigId, address pairToken) view returns (bytes32)",
  "function launchFee() view returns (uint256)",
  "struct LaunchedToken { address token; address curve; address deployer; address creatorFeeRecipient; address pairToken; uint256 graduationThreshold; uint24 poolFee; int24 tickSpacing; uint16 creatorTaxBps; bool buybackEnabled; uint8 phase; uint256 sweptQuote; uint256 sweptTokens; uint256 sweptAt; bool exists; }",
  "function getLaunchedToken(address token) view returns (LaunchedToken launch)",
  "function createGraduatedPool(address token)",
  "event TokenLaunched(address indexed token, address indexed curve, address indexed deployer, address pairToken, uint256 launchConfigId, uint256 graduationThreshold)",
]);
const pancakeAbi = parseAbi([
  "function swapExactETHForTokens(uint256 amountOutMin, address[] path, address to, uint256 deadline) payable returns (uint256[] amounts)",
]);

// The tokens seen on the stack's curves; a stack the test lists none for fails it.
function tokensOf(stack: string): readonly Address[] {
  const tokens = seenOnCurves[stack];
  if (tokens === undefined) {
    throw new Error(`No token is listed for stack ${stack}.`);
  }
  return tokens;
}

interface Trading {
  readonly fork: Fork;
  readonly signal: AbortSignal;
  readonly venue: LaunchpadVenue;
}

const accountOf = (fork: Fork, address: Address): AccountRef =>
  accountRefSchema.parse(`${fork.chain.ref}:${address}`);

function assetOf(fork: Fork, address: Address): AssetRef {
  return address === zeroAddress
    ? fork.chain.nativeAsset
    : assetRefSchema.parse(`${fork.chain.ref}/erc20:${address}`);
}

function tradingOn(fork: Fork, signal: AbortSignal): Trading {
  const quoteTokens = [assetOf(fork, usdt), assetOf(fork, bscToken("USDC"))];
  const { ref: chain, nativeAsset } = fork.chain;
  const venue = createGeniusfunVenue({
    chains: [{ chain, nativeAsset, quoteTokens, rpc: fork.rpc }],
  });
  return { fork, signal, venue };
}

function registryOf(fork: Fork): Readonly<Record<string, AccountRef>> {
  return Object.fromEntries(
    Object.entries(registry).map(([name, address]) => [name, accountOf(fork, address)]),
  );
}

/** A token the venue holds on its curve: the request contracts with its curve, and its quote. */
interface Held {
  readonly contracts: Readonly<Record<string, AccountRef>>;
  readonly quoteAsset: AssetRef;
}

// The registry's factories with the launch's curve the venue's curve read names for the token;
// undefined for a token it does not hold with a curve.
async function heldOf(trading: Trading, token: Address): Promise<Held | undefined> {
  const contracts = registryOf(trading.fork);
  const asked = { token: assetOf(trading.fork, token), contracts };
  const holding = await trading.venue.curve(asked, { signal: trading.signal });
  return holding.onCurve && holding.launch !== undefined
    ? { contracts: { ...contracts, ...holding.launch }, quoteAsset: holding.quoteAsset }
    : undefined;
}

async function mustHold(trading: Trading, token: Address): Promise<Held> {
  const held = await heldOf(trading, token);
  if (held === undefined) {
    throw new Error(`Genius.fun does not hold ${token} on a curve.`);
  }
  return held;
}

/** A live token on its curve against BNB, and what the venue holds of it. */
interface LiveToken extends Held {
  readonly token: Address;
}

// The first of the tokens that still trades on its curve against BNB.
async function liveToken(trading: Trading, tokens: readonly Address[]): Promise<LiveToken> {
  const [token, ...rest] = tokens;
  if (token === undefined) {
    throw new Error("No token seen on a curve of the stack trades there now.");
  }
  const held = await heldOf(trading, token);
  return held?.quoteAsset === trading.fork.chain.nativeAsset
    ? { token, ...held }
    : liveToken(trading, rest);
}

function lastOf(drafts: readonly TxDraft[]): TxDraft {
  const last = drafts.at(-1);
  if (last === undefined) {
    throw new Error("The venue built nothing.");
  }
  return last;
}

const callOf = (draft: TxDraft) => successOf(decodeEvmDraft(draft));

async function balanceOf(fork: Fork, asset: Address, owner: Address): Promise<bigint> {
  if (asset === zeroAddress) {
    return fork.client.getBalance({ address: owner });
  }
  const args = [owner] as const;
  return fork.client.readContract({
    address: asset,
    abi: erc20Abi,
    functionName: "balanceOf",
    args,
  });
}

const gasPaid = (receipts: readonly TransactionReceipt[]): bigint =>
  receipts.reduce((total, receipt) => total + receipt.gasUsed * receipt.effectiveGasPrice, 0n);

// What the curve's own `buy` or `sell`, called from the wallet at the fork's latest block, pays.
async function curveAnswer(fork: Fork, draft: TxDraft, side: "buy" | "sell"): Promise<bigint> {
  const { from, to, value, data } = callOf(draft);
  const answer = await fork.client.call({ account: from, to, value, data });
  return decodeFunctionResult({ abi: curveAbi, functionName: side, data: answer.data ?? "0x" });
}

/**
 * A trade on the fork: its quote, what the curve's own call answered, what it paid, and what the
 * curve may still spend of the trade's input token afterwards (none for the coin).
 */
interface Traded {
  readonly quote: VenueQuote;
  readonly curveOut: bigint;
  readonly received: bigint;
  readonly steps: readonly TransactionReceipt[];
  readonly leftApproved: bigint;
}

// What the curve may still spend of the wallet's `asset`; the coin needs no approval.
async function approvedOf(fork: Fork, asset: Address, curve: AccountRef): Promise<bigint> {
  if (asset === zeroAddress) {
    return 0n;
  }
  const spender = getAddress(String(curve).slice(-42));
  const args = [fork.account, spender] as const;
  return fork.client.readContract({
    address: asset,
    abi: erc20Abi,
    functionName: "allowance",
    args,
  });
}

interface Trade {
  readonly side: "buy" | "sell";
  readonly amountIn: bigint;
  readonly input: Address;
  readonly output: Address;
}

async function quoteOf(trading: Trading, request: QuoteRequest): Promise<VenueQuote> {
  const quoted = await trading.venue.quote(request, { signal: trading.signal });
  if (!quoted.ok) {
    throw new Error(`Genius.fun gave no quote: ${quoted.error}.`);
  }
  return quoted.value;
}

// Quotes, builds and sends one trade from the fork's account as the venue host would; the curve's
// own call is asked once every step before the trade call has landed.
async function trade(trading: Trading, held: Held, asked: Trade): Promise<Traded> {
  const { fork, venue, signal } = trading;
  const request: QuoteRequest = {
    wallet: accountOf(fork, fork.account),
    amountIn: { asset: assetOf(fork, asked.input), base: asked.amountIn },
    assetOut: assetOf(fork, asked.output),
    contracts: held.contracts,
  };
  const quote = await quoteOf(trading, request);
  const terms = hostBuildRequest(request, quote, { deadlineMs: Date.now() + 60_000, keepBps });
  const drafts = await venue.build(terms, { signal });
  expect(venue.decode(lastOf(drafts))).toStrictEqual({
    ok: true,
    value: { recipient: request.wallet, amountIn: request.amountIn, minOut: terms.minOut },
  });
  const before = await balanceOf(fork, asked.output, fork.account);
  const approvals = await Promise.all(
    drafts.slice(0, -1).map(async (draft) => fork.send(callOf(draft))),
  );
  const curveOut = await curveAnswer(fork, lastOf(drafts), asked.side);
  const steps = [...approvals, await fork.send(callOf(lastOf(drafts)))];
  const gas = asked.output === zeroAddress ? gasPaid(steps) : 0n;
  const received = (await balanceOf(fork, asked.output, fork.account)) - before + gas;
  const curve = held.contracts["curve"] ?? accountOf(fork, zeroAddress);
  const leftApproved = await approvedOf(fork, asked.input, curve);
  return { quote, curveOut, received, steps, leftApproved };
}

/** A buy of a token on its curve with an amount of its quote asset, and the sale back. */
interface RoundTrip {
  readonly token: Address;
  readonly quote: Address;
  readonly amountIn: bigint;
}

// A buy with `amountIn` of `quote`, then a sale of all it bought back into `quote`.
async function roundTrip(trading: Trading, held: Held, legs: RoundTrip) {
  const { token, quote, amountIn } = legs;
  const buy = await trade(trading, held, { side: "buy", amountIn, input: quote, output: token });
  const sale = await trade(trading, held, {
    side: "sell",
    amountIn: buy.received,
    input: token,
    output: quote,
  });
  return { buy, sale };
}

// What a leg's quote named, what the curve's own call answered, and what the trade paid.
const paidOf = ({ quote, curveOut, received }: Traded) => [
  quote.expectedOut.base,
  curveOut,
  received,
];

function report(fork: Fork, token: Address, traded: readonly Traded[]): string {
  const legs = traded.map(
    ({ quote, curveOut, received, steps }) =>
      `quoted ${String(quote.expectedOut.base)} (curve's own call ${String(curveOut)}), impact ${String(quote.priceImpactBps)} bp, tax ${String(quote.taxBps ?? 0)} bp, received ${String(received)} in ${String(steps.length)} step(s)`,
  );
  return `block ${String(fork.block)}, token ${token}: ${legs.join("; ")}`;
}

// The price the venue's price read gives from its calls answered on the fork, and the curve's own
// reserves, read apart.
async function pricesOf(trading: Trading, token: Address, held: Held) {
  const { fork, venue, signal } = trading;
  const asked = { token: assetOf(fork, token), contracts: held.contracts };
  const priceRead = venue.priceRead?.bind(venue);
  if (priceRead === undefined) {
    throw new Error("The venue declares no price read.");
  }
  const read = successOf(await priceRead(asked, { signal }));
  const answers = await Promise.all(
    read.calls.map(async ({ target, input }) => {
      const to = getAddress(target.slice(target.lastIndexOf(":") + 1));
      return (await fork.client.call({ to, data: `0x${input.slice(2)}` })).data;
    }),
  );
  const curve = getAddress(String(held.contracts["curve"]).slice(-42));
  const [quoteReserve, tokenReserve] = await fork.client.readContract({
    address: curve,
    abi: curveAbi,
    functionName: "getReserves",
  });
  return {
    price: read.price(answers),
    reserves: { numerator: quoteReserve, denominator: tokenReserve },
  };
}

// The terms of a fork launch with no creator tax, against the economics the factory quotes.
function launchParams(economics: Hex) {
  const socials = { twitter: "", telegram: "", discord: "", website: "", farcaster: "" };
  return {
    name: "Fork Test",
    symbol: "FORK",
    logo: "",
    description: "",
    socials,
    creatorFeeRecipient: zeroAddress,
    creatorTaxBps: 0,
    buybackEnabled: true,
    expectedEconomics: economics,
    salt: toHex(BigInt(Date.now()), { size: 32 }),
  };
}

// A token the fork's account launches on the m4.2 stack against `pairToken`, exempting `exempt`.
async function launch(fork: Fork, pairToken: Address, exempt: readonly Address[]) {
  const address = factoryM42;
  const [fee, economics] = await Promise.all([
    fork.client.readContract({ address, abi: factoryAbi, functionName: "launchFee" }),
    fork.client.readContract({
      address,
      abi: factoryAbi,
      functionName: "previewLaunchEconomics",
      args: [0n, pairToken],
    }),
  ]);
  const args = [launchParams(economics), 0n, pairToken, false, [...exempt]] as const;
  const data = encodeFunctionData({ abi: factoryAbi, functionName: "launchToken", args });
  const receipt = await fork.send({ from: fork.account, to: address, value: fee, data });
  const [event] = await fork.client.getContractEvents({
    address,
    abi: factoryAbi,
    eventName: "TokenLaunched",
    blockHash: receipt.blockHash,
  });
  const token = event?.args.token;
  const curve = event?.args.curve;
  if (receipt.status !== "success" || token === undefined || curve === undefined) {
    throw new Error("The launch named no token.");
  }
  return { token, curve };
}

// USDT for a buy, bought through PancakeSwap's v2 router so the test stands on its own.
async function holdUsdt(fork: Fork): Promise<void> {
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 300);
  const data = encodeFunctionData({
    abi: pancakeAbi,
    functionName: "swapExactETHForTokens",
    args: [0n, [bscToken("WBNB"), usdt], fork.account, deadline],
  });
  const to = bscContract("pancakeswap", "v2-router");
  await fork.send({ from: fork.account, to, value: parseEther("0.05"), data });
}

// What a buy in the launch window is quoted, and what the curve reads for its wallet.
async function windowBuy(trading: Trading, token: Address, held: Held) {
  const { fork } = trading;
  const buyer: Address = "0x00000000000000000000000000000000000Ba5E5";
  const quote = await quoteOf(trading, {
    wallet: accountOf(fork, buyer),
    amountIn: { asset: fork.chain.nativeAsset, base: parseEther("0.01") },
    assetOut: assetOf(fork, token),
    contracts: held.contracts,
  });
  const curve = getAddress(String(held.contracts["curve"]).slice(-42));
  const snipeTax = await fork.client.readContract({
    address: curve,
    abi: curveAbi,
    functionName: "currentSnipeTaxBps",
    args: [buyer],
  });
  return { quote, snipeTax };
}

describe("geniusfun on a BSC fork", () => {
  it.for(["m4.2", "m4.1"])(
    "buys and sells a live token on its %s curve, to the wei of the quote and the curve's own call",
    async (stack, { signal, annotate }) =>
      withFork(signal, async (fork) => {
        const trading = tradingOn(fork, signal);
        const { token, ...held } = await liveToken(trading, tokensOf(stack));
        const { price, reserves } = await pricesOf(trading, token, held);
        expect(price).toStrictEqual({ ok: true, value: reserves });
        const amountIn = parseEther("0.05");
        const { buy, sale } = await roundTrip(trading, held, {
          token,
          quote: zeroAddress,
          amountIn,
        });
        const statuses = [...buy.steps, ...sale.steps].map((step) => step.status);
        expect(statuses).toStrictEqual(["success", "success", "success"]);
        expect(paidOf(buy)).toStrictEqual(Array(3).fill(buy.quote.expectedOut.base));
        expect(paidOf(sale)).toStrictEqual(Array(3).fill(sale.quote.expectedOut.base));
        expect(await balanceOf(fork, token, fork.account)).toBe(0n);
        expect(sale.leftApproved).toBe(0n);
        await annotate(report(fork, token, [buy, sale]));
      }),
  );

  it("names a buy's snipe tax in a launch's first second, and the wallets it exempted", async ({
    signal,
    annotate,
  }) =>
    withFork(signal, async (fork) => {
      const trading = tradingOn(fork, signal);
      const insider: Address = "0x000000000000000000000000000000000000bEEF";
      const { token, curve } = await launch(fork, zeroAddress, [insider]);
      const held = await mustHold(trading, token);
      expect(held.contracts["curve"]).toBe(accountOf(fork, curve));
      const { quote, snipeTax } = await windowBuy(trading, token, held);
      // The curve reads 99% in the launch second and bounds it so the buyer keeps 1% after its 2%
      // fee: the quote names that bound.
      expect(snipeTax).toBe(9_900n);
      expect(quote).toMatchObject({ taxBps: 9_700, snipeTaxBps: 9_700 });
      // The wallet the launch exempted buys in the same second untaxed.
      const exempt = await quoteOf(trading, {
        wallet: accountOf(fork, insider),
        amountIn: { asset: fork.chain.nativeAsset, base: parseEther("0.01") },
        assetOut: assetOf(fork, token),
        contracts: held.contracts,
      });
      expect(exempt).not.toHaveProperty("taxBps");
      expect(exempt).not.toHaveProperty("snipeTaxBps");
      const launched = { token: assetOf(fork, token), contracts: registryOf(fork) };
      const insiders = await trading.venue.insiders?.(launched, { signal });
      expect(insiders).toStrictEqual([accountOf(fork, fork.account), accountOf(fork, insider)]);
      await annotate(
        `block ${String(fork.block)}, launched ${token} on curve ${curve}: currentSnipeTaxBps ${String(snipeTax)}, quote tax ${String(quote.taxBps)} bp, snipe ${String(quote.snipeTaxBps)} bp, out ${String(quote.expectedOut.base)}; insiders ${JSON.stringify(insiders)}`,
      );
    }));

  it("buys with USDT and sells back to USDT on a USDT curve, past its launch window", async ({
    signal,
    annotate,
  }) =>
    withFork(signal, async (fork) => {
      const trading = tradingOn(fork, signal);
      const { token } = await launch(fork, usdt, []);
      await fork.call("evm_increaseTime", [16]);
      await fork.call("evm_mine", []);
      await holdUsdt(fork);
      const held = await mustHold(trading, token);
      expect(held.quoteAsset).toBe(assetOf(fork, usdt));
      const amountIn = parseEther("5");
      const { buy, sale } = await roundTrip(trading, held, { token, quote: usdt, amountIn });
      const statuses = [...buy.steps, ...sale.steps].map((step) => step.status);
      expect(statuses).toStrictEqual(Array(4).fill("success"));
      expect(paidOf(buy)).toStrictEqual(Array(3).fill(buy.quote.expectedOut.base));
      expect(paidOf(sale)).toStrictEqual(Array(3).fill(sale.quote.expectedOut.base));
      expect([buy.leftApproved, sale.leftApproved]).toStrictEqual([0n, 0n]);
      await annotate(report(fork, token, [buy, sale]));
    }));

  it("quotes no buy past a curve's end, holds the swept launch with no curve, and lets go at its pool", async ({
    signal,
    annotate,
  }) =>
    withFork(signal, async (fork) => {
      // A fresh launch's curve sells its tokens for about 15 BNB: 30 BNB takes the rest. The venue
      // quotes no such buy; one sent straight to the curve sweeps it, and the pool comes after.
      const trading = tradingOn(fork, signal);
      const { token, curve } = await launch(fork, zeroAddress, []);
      await fork.call("evm_increaseTime", [16]);
      await fork.call("evm_mine", []);
      const held = await mustHold(trading, token);
      const crossing = parseEther("30");
      const request = {
        wallet: accountOf(fork, fork.account),
        amountIn: { asset: fork.chain.nativeAsset, base: crossing },
        assetOut: assetOf(fork, token),
        contracts: held.contracts,
      };
      await expect(trading.venue.quote(request, { signal })).resolves.toStrictEqual({
        ok: false,
        error: "no_route",
      });
      const data = encodeFunctionData({
        abi: curveAbi,
        functionName: "buy",
        args: [crossing, 0n, fork.account],
      });
      await fork.call("anvil_setBalance", [fork.account, toHex(parseEther("100"))]);
      const receipt = await fork.send({ from: fork.account, to: curve, value: crossing, data });
      const [record, sellable] = await Promise.all([
        fork.client.readContract({
          address: factoryM42,
          abi: factoryAbi,
          functionName: "getLaunchedToken",
          args: [token],
        }),
        fork.client.readContract({ address: curve, abi: curveAbi, functionName: "sellableTokens" }),
      ]);
      const asked = { token: assetOf(fork, token), contracts: registryOf(fork) };
      const holding = await trading.venue.curve(asked, { signal });
      const pool = encodeFunctionData({
        abi: factoryAbi,
        functionName: "createGraduatedPool",
        args: [token],
      });
      const made = await fork.send({ from: fork.account, to: factoryM42, data: pool });
      const after = await fork.client.readContract({
        address: factoryM42,
        abi: factoryAbi,
        functionName: "getLaunchedToken",
        args: [token],
      });
      const graduated = await trading.venue.curve(asked, { signal });
      await annotate(
        `block ${String(fork.block)}, launched ${token} on curve ${curve}: a 30 BNB buy ${receipt.status}, phase ${String(record.phase)}, sellable ${String(sellable)}; curve read ${JSON.stringify(holding)}; createGraduatedPool ${made.status}, phase ${String(after.phase)}, curve read ${JSON.stringify(graduated)}`,
      );
      expect([receipt.status, record.phase, sellable]).toStrictEqual(["success", 1, 0n]);
      expect(holding).toStrictEqual({ onCurve: true, quoteAsset: fork.chain.nativeAsset });
      expect([made.status, after.phase]).toStrictEqual(["success", 2]);
      expect(graduated).toStrictEqual({ onCurve: false });
    }));
});
