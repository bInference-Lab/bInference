import { bscContract, bscToken, type Fork, withFork } from "@binference/chain-evm/fork";
import {
  type AccountRef,
  accountRefParts,
  accountRefSchema,
  type AssetRef,
  assetRefParts,
  assetRefSchema,
  BinferenceError,
  type Bridge,
  type BridgeQuoteRequest,
  type Http,
  type TxDraft,
} from "@binference/plugin-sdk";
import { decodeEvmDraft } from "@binference/plugin-sdk/evm";
import { draftAt, successOf } from "@binference/plugin-sdk/testing";
import {
  encodeFunctionData,
  getAddress,
  pad,
  parseAbi,
  parseEventLogs,
  toHex,
  type TransactionReceipt,
} from "viem";
import { describe, expect, it } from "vitest";
import { createAcrossBridge } from "../across-bridge.js";
import type { AcrossRoute } from "../across-options.js";

const apiOrigin = "https://app.across.to";
const apiTimeoutMs = 20_000;
const spokePool = bscContract("across", "spoke-pool");
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
// BSC's Binance-Peg USDC has 18 decimals, Base's USDC 6, as the registry lists them.
const usdcDecimals = { leaves: 18, arrives: 6 };
const usdcSent = { leaves: "USDC", amount: 20n * 10n ** 18n } as const;
const pancakeAbi = parseAbi([
  "function swapExactETHForTokens(uint256 amountOutMin, address[] path, address to, uint256 deadline) payable returns (uint256[] amounts)",
]);
const depositEvents = parseAbi([
  "event FundsDeposited(bytes32 inputToken, bytes32 outputToken, uint256 inputAmount, uint256 outputAmount, uint256 indexed destinationChainId, uint256 indexed depositId, uint32 quoteTimestamp, uint32 fillDeadline, uint32 exclusivityDeadline, bytes32 indexed depositor, bytes32 recipient, bytes32 exclusiveRelayer, bytes message)",
]);

// The fork suite reads Across's public API and refuses every other host.
const acrossHttp: Http = {
  async request(request) {
    if (new URL(request.url).origin !== apiOrigin) {
      throw new BinferenceError({
        code: "fork.call_refused",
        message: "The fork suite reaches no host but Across's API.",
      });
    }
    // oxlint-disable-next-line eslint/no-restricted-globals -- the fork suite reads Across's public API
    const response = await fetch(request.url, {
      method: request.method,
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(apiTimeoutMs)]),
    });
    return { status: response.status, headers: {}, body: await response.text() };
  },
};

function tokenOn(fork: Fork, symbol: string): AssetRef {
  return assetRefSchema.parse(`${fork.chain.ref}/erc20:${bscToken(symbol)}`);
}

function bridgeOn(fork: Fork, routes: readonly AcrossRoute[]): Bridge {
  return createAcrossBridge({ http: acrossHttp, chains: [fork.chain.ref], routes });
}

// A card's request: `amount` of the registry token `leaves` for the person on `arrives`'s chain.
function requestOn(
  fork: Fork,
  sent: { readonly leaves: string; readonly amount: bigint },
  arrives: AssetRef,
): BridgeQuoteRequest {
  const { leaves, amount } = sent;
  const destination = assetRefParts(arrives).chain;
  return {
    wallet: accountRefSchema.parse(`${fork.chain.ref}:${fork.account}`),
    amountIn: { asset: tokenOn(fork, leaves), base: amount },
    recipient: accountRefSchema.parse(`${destination}:${evmPerson}`),
    deliveredAsset: arrives,
    cappedAssets: [tokenOn(fork, leaves)],
    contracts: { "spoke-pool": accountRefSchema.parse(`${fork.chain.ref}:${spokePool}`) },
  };
}

// A token bought with 1 BNB through PancakeSwap's v2 router, so the deposit stands on its own.
async function buy(fork: Fork, symbol: string): Promise<void> {
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 300);
  const data = encodeFunctionData({
    abi: pancakeAbi,
    functionName: "swapExactETHForTokens",
    args: [0n, [bscToken("WBNB"), bscToken(symbol)], fork.account, deadline],
  });
  const router = bscContract("pancakeswap", "v2-router");
  await fork.send({ from: fork.account, to: router, value: 10n ** 18n, data });
}

async function sendDraft(fork: Fork, draft: TxDraft): Promise<TransactionReceipt> {
  const call = successOf(decodeEvmDraft(draft));
  return await fork.send({ from: fork.account, to: call.to, data: call.data });
}

// Sends the bridge's drafts in order, the block's time no earlier than the quote's, as the live
// chain's is when the card is tapped.
async function sendDeposit(fork: Fork, bridge: Bridge, request: BridgeQuoteRequest) {
  const quote = successOf(
    await bridge.quote(request, { signal: AbortSignal.timeout(apiTimeoutMs) }),
  );
  const drafts = await bridge.build(
    { ...request, quote, minOut: quote.minOut },
    { signal: AbortSignal.timeout(apiTimeoutMs) },
  );
  const head = await fork.client.getBlock();
  const quotedAt = BigInt(quote.quotedAtMs / 1000);
  const next = head.timestamp > quotedAt ? head.timestamp + 1n : quotedAt + 1n;
  await fork.call("evm_setNextBlockTimestamp", [toHex(next)]);
  // The approval must land before the deposit that spends it.
  await sendDraft(fork, draftAt(drafts, 0));
  const receipt = await sendDraft(fork, draftAt(drafts, 1));
  return { quote, decoded: successOf(bridge.decode(draftAt(drafts, 1))), receipt };
}

function depositLogOf(receipt: TransactionReceipt) {
  const logs = parseEventLogs({ abi: depositEvents, logs: receipt.logs });
  const log = logs.find((item) => getAddress(item.address) === spokePool);
  if (log === undefined) {
    throw new BinferenceError({
      code: "fork.no_deposit",
      message: "The SpokePool logged no deposit.",
    });
  }
  return log.args;
}

function addressWord(account: AccountRef): string {
  return pad(getAddress(accountRefParts(account).address)).toLowerCase();
}

describe("across on a BSC fork", () => {
  it("deposits USDC for Base whose logged recipient is the card's EVM address", async ({
    signal,
  }) => {
    await withFork(signal, async (fork) => {
      await buy(fork, "USDC");
      const request = requestOn(fork, usdcSent, baseUsdc);
      const bridge = bridgeOn(fork, [
        { leaves: tokenOn(fork, "USDC"), arrives: baseUsdc, decimals: usdcDecimals },
      ]);
      const { quote, decoded, receipt } = await sendDeposit(fork, bridge, request);
      expect(receipt.status).toBe("success");
      expect(decoded).toMatchObject({ kind: "bound", recipient: request.recipient });
      const logged = depositLogOf(receipt);
      expect(logged.recipient).toBe(addressWord(request.recipient));
      expect(logged.depositor).toBe(addressWord(request.wallet));
      expect(logged.destinationChainId).toBe(8453n);
      expect(logged.outputAmount).toBe(quote.minOut.base);
      expect(logged.message).toBe("0x");
    });
  }, 120_000);

  it("answers no_route for a Solana card and builds no deposit, as Across serves Solana from no BSC route", async ({
    signal,
  }) => {
    await withFork(signal, async (fork) => {
      const usdc = tokenOn(fork, "USDC");
      const bridge = bridgeOn(fork, [{ leaves: usdc, arrives: baseUsdc, decimals: usdcDecimals }]);
      const solanaCard = {
        ...requestOn(fork, usdcSent, solanaUsdc),
        recipient: accountRefSchema.parse(
          `solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp:${solanaPerson}`,
        ),
      };
      await expect(bridge.quote(solanaCard, { signal })).resolves.toStrictEqual({
        ok: false,
        error: "no_route",
      });
      const quote = successOf(await bridge.quote(requestOn(fork, usdcSent, baseUsdc), { signal }));
      await expect(
        bridge.build({ ...solanaCard, quote, minOut: { asset: solanaUsdc, base: 1n } }, { signal }),
      ).rejects.toMatchObject({ code: "across.no_route" });
    });
  }, 60_000);
});
