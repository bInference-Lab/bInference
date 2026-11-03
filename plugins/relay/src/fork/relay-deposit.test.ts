import { bscContract, bscToken, type Fork, withFork } from "@binference/chain-evm/fork";
import {
  type AccountRef,
  accountRefParts,
  accountRefSchema,
  type AssetRef,
  assetRefSchema,
  BinferenceError,
  type Bridge,
  type BridgeQuoteRequest,
  type Http,
  type TxDraft,
} from "@binference/plugin-sdk";
import { decodeEvmDraft } from "@binference/plugin-sdk/evm";
import { createManualClock, draftAt, successOf } from "@binference/plugin-sdk/testing";
import {
  encodeFunctionData,
  getAddress,
  keccak256,
  parseAbi,
  parseEventLogs,
  slice,
  stringToHex,
  toHex,
  type TransactionReceipt,
} from "viem";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createRelayBridge } from "../relay-bridge.js";
import { relaySolver } from "../relay-chains.js";

const apiOrigin = "https://api.relay.link";
const apiTimeoutMs = 20_000;
const depository = bscContract("relay", "depository");
// The tokens that arrive, as the destination chains' registry entries list them.
const baseUsdc = assetRefSchema.parse(
  "eip155:8453/erc20:0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
);
const solanaUsdc = assetRefSchema.parse(
  "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp/token:EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
);
// The saved addresses the cards name: a person's wallet on each destination.
const evmPerson = getAddress("0x00000000000000000000000000000000c0ffee01");
const solanaPerson = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
const sent = 20n * 10n ** 18n;
// The bridge wallet: a fresh account the fork impersonates. Relay's screening blocks anvil's own
// first account (`BLOCKED_WALLET_ADDRESS`), a well-known key on every chain.
const bridgeWallet = getAddress(
  slice(keccak256(stringToHex("binference relay fork bridge wallet")), 12),
);
const pancakeAbi = parseAbi([
  "function swapExactETHForTokens(uint256 amountOutMin, address[] path, address to, uint256 deadline) payable returns (uint256[] amounts)",
]);
const depositEvents = parseAbi([
  "event RelayErc20Deposit(address from, address token, uint256 amount, bytes32 id)",
]);
const recordSchema = z.looseObject({
  recipient: z.string(),
  destination: z.string(),
  orderId: z.string(),
  minimumAmount: z.string(),
});

// The fork suite reads Relay's public API and refuses every other host.
const relayHttp: Http = {
  async request(request) {
    if (new URL(request.url).origin !== apiOrigin) {
      throw new BinferenceError({
        code: "fork.call_refused",
        message: "The fork suite reaches no host but Relay's API.",
      });
    }
    // oxlint-disable-next-line eslint/no-restricted-globals -- the fork suite reads Relay's public API
    const response = await fetch(request.url, {
      method: request.method,
      headers: { ...request.headers },
      ...(request.body === undefined ? {} : { body: request.body }),
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(apiTimeoutMs)]),
    });
    return { status: response.status, headers: {}, body: await response.text() };
  },
};

function tokenOn(fork: Fork, symbol: string): AssetRef {
  return assetRefSchema.parse(`${fork.chain.ref}/erc20:${bscToken(symbol)}`);
}

// The bridge as the composition makes it for the fork's chain, at the time the fork's head shows.
async function bridgeOn(fork: Fork, arrives: AssetRef): Promise<Bridge> {
  const head = await fork.client.getBlock();
  const decimals = { leaves: 18, arrives: 6 };
  return createRelayBridge({
    http: relayHttp,
    clock: createManualClock(Number(head.timestamp) * 1000),
    chains: [fork.chain.ref],
    routes: [{ leaves: tokenOn(fork, "USDC"), arrives, decimals }],
    depositories: { [fork.chain.ref]: accountRefSchema.parse(`${fork.chain.ref}:${depository}`) },
    solver: relaySolver,
  });
}

// A card's request: 20 BSC USDC from the bridge wallet, the fork's account, to `recipient`.
function requestOn(fork: Fork, recipient: AccountRef, arrives: AssetRef): BridgeQuoteRequest {
  return {
    wallet: accountRefSchema.parse(`${fork.chain.ref}:${bridgeWallet}`),
    amountIn: { asset: tokenOn(fork, "USDC"), base: sent },
    recipient,
    deliveredAsset: arrives,
    cappedAssets: [tokenOn(fork, "USDC")],
    contracts: { depository: accountRefSchema.parse(`${fork.chain.ref}:${depository}`) },
  };
}

// USDC bought with 1 BNB through PancakeSwap's v2 router, so the deposit stands on its own.
async function buyUsdc(fork: Fork): Promise<void> {
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 300);
  const data = encodeFunctionData({
    abi: pancakeAbi,
    functionName: "swapExactETHForTokens",
    args: [0n, [bscToken("WBNB"), bscToken("USDC")], bridgeWallet, deadline],
  });
  const router = bscContract("pancakeswap", "v2-router");
  await fork.send({ from: bridgeWallet, to: router, value: 10n ** 18n, data });
}

async function sendDraft(fork: Fork, draft: TxDraft): Promise<TransactionReceipt> {
  const call = successOf(decodeEvmDraft(draft));
  return await fork.send({ from: bridgeWallet, to: call.to, data: call.data });
}

// Quotes through Relay's live API, builds, and sends the approval then the deposit.
async function sendDeposit(fork: Fork, bridge: Bridge, request: BridgeQuoteRequest) {
  const signal = AbortSignal.timeout(apiTimeoutMs);
  const quote = successOf(await bridge.quote(request, { signal }));
  const drafts = await bridge.build({ ...request, quote, minOut: quote.minOut }, { signal });
  // The approval must land before the deposit that spends it.
  await sendDraft(fork, draftAt(drafts, 0));
  const receipt = await sendDraft(fork, draftAt(drafts, 1));
  const record = recordSchema.parse(JSON.parse(String(quote.route)));
  return { quote, record, decoded: successOf(bridge.decode(draftAt(drafts, 1))), receipt };
}

function depositLogOf(receipt: TransactionReceipt) {
  const logs = parseEventLogs({ abi: depositEvents, logs: receipt.logs });
  const log = logs.find((item) => getAddress(item.address) === depository);
  if (log === undefined) {
    throw new BinferenceError({
      code: "fork.no_deposit",
      message: "The depository logged no deposit.",
    });
  }
  return log.args;
}

// Deposits 20 USDC for `recipient` from the bridge wallet on a fresh fork, and holds the logged
// deposit to the order the card's quote checked: from the wallet, exactly the token and amount, and
// the order id the record keeps for the card's recipient and chain.
async function provesDeposit(
  signal: AbortSignal,
  card: { readonly to: string; readonly arrives: AssetRef; readonly destination: string },
): Promise<void> {
  await withFork(signal, async (fork) => {
    await fork.call("anvil_impersonateAccount", [bridgeWallet]);
    await fork.call("anvil_setBalance", [bridgeWallet, toHex(10n ** 19n)]);
    await buyUsdc(fork);
    const recipient = accountRefSchema.parse(card.to);
    const request = requestOn(fork, recipient, card.arrives);
    const bridge = await bridgeOn(fork, card.arrives);
    const { quote, record, decoded, receipt } = await sendDeposit(fork, bridge, request);
    expect(receipt.status).toBe("success");
    expect(decoded).toMatchObject({
      kind: "order",
      depositor: request.wallet,
      orderId: record.orderId,
    });
    expect(record).toMatchObject({
      recipient: accountRefParts(recipient).address,
      destination: card.destination,
      minimumAmount: quote.minOut.base.toString(),
    });
    const logged = depositLogOf(receipt);
    expect(getAddress(logged.from)).toBe(bridgeWallet);
    expect(getAddress(logged.token)).toBe(bscToken("USDC"));
    expect(logged.amount).toBe(sent);
    expect(logged.id).toBe(record.orderId);
  });
}

describe("relay on a BSC fork", () => {
  it("deposits USDC for Base from the bridge wallet, logging the order its card's quote checked", async ({
    signal,
  }) => {
    const deposited = provesDeposit(signal, {
      to: `eip155:8453:${evmPerson}`,
      arrives: baseUsdc,
      destination: "base",
    });
    await expect(deposited).resolves.toBeUndefined();
  }, 120_000);

  it("deposits USDC for a Solana address from the bridge wallet, logging the order its card's quote checked", async ({
    signal,
  }) => {
    const deposited = provesDeposit(signal, {
      to: `solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp:${solanaPerson}`,
      arrives: solanaUsdc,
      destination: "solana",
    });
    await expect(deposited).resolves.toBeUndefined();
  }, 120_000);
});
