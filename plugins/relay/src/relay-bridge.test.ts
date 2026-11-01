import {
  accountRefSchema,
  assetRefSchema,
  chainRefSchema,
  type TxHash,
} from "@binference/plugin-sdk";
import { bridgeContract, draftAt, successOf } from "@binference/plugin-sdk/testing";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createRelayBridge, relayDeclaration } from "./relay-bridge.js";
import {
  base,
  bsc,
  depository,
  recordedApi,
  recordedAtMs,
  recordedDeposits,
  recordedOptions,
  recordedRoutes,
  requestFor,
  solana,
  tokens,
  wallet,
} from "./testing/bridge-fixtures.js";
import {
  recordedBareTransferCheck,
  recordedFillCheck,
  recordedSolanaFillCheck,
} from "./testing/recorded-settlements.js";

const live = { signal: new AbortController().signal };
const noRoute = { ok: false, error: "no_route" };
const unknownCall = { ok: false, error: "unknown_call" };
const deposit = (hash: string) => ({ chain: bsc, hash: hash as TxHash });
const usdc = (units: bigint) => ({ asset: tokens.usdc, base: units });

describe("the Relay bridge", () => {
  it.each(
    bridgeContract({
      create: async () =>
        await Promise.resolve({
          bridge: createRelayBridge(recordedOptions()),
          request: requestFor(tokens.usdc, tokens.baseUsdc),
          unserved: requestFor(tokens.usdt, tokens.baseUsdc),
          otherRecipient: accountRefSchema.parse(`${base}:0x${"33".repeat(20)}`),
          deposits: "order",
          filled: {
            deposit: deposit(recordedDeposits.fillBase),
            fill: {
              chain: base,
              hash: "0xc271169154e8dbd4805b0ce299060677b1ae2ded518335eb298ee00cd764a82f" as TxHash,
            },
          },
          refunded: {
            deposit: deposit(recordedDeposits.refund),
            refund: deposit("0x9b79626d1690f2e447db3cb3fcb0899be04f5485bd2f952aa9b2f3a267995b34"),
          },
          expired: deposit(recordedDeposits.expired),
          unseen: deposit(recordedDeposits.unseen),
          settled: { check: recordedFillCheck, paid: 343_283n },
          stranger: recordedBareTransferCheck,
        }),
    }),
  )("follows the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });

  it("quotes the recorded USDC route to Base with Relay's fees, time and the order's output", async () => {
    const quote = await createRelayBridge(recordedOptions()).quote(
      requestFor(tokens.usdc, tokens.baseUsdc),
      live,
    );
    expect(quote).toStrictEqual({
      ok: true,
      value: {
        expectedOut: { asset: tokens.baseUsdc, base: 19_899_080n },
        minOut: { asset: tokens.baseUsdc, base: 19_899_080n },
        fees: [
          { kind: "relayer", amount: usdc(100_005_101_300_831_712n) },
          { kind: "gas", amount: usdc(915_769_092_405_393n) },
        ],
        etaSeconds: 2,
        quotedAtMs: recordedAtMs,
        expiresAtMs: recordedAtMs + 3_300_000,
        route: expect.any(String) as string,
      },
    });
  });

  it.each(recordedRoutes)(
    "builds a depositErc20 of $leaves for $arrives that decodes to the order it quoted",
    async ({ leaves, arrives }) => {
      const bridge = createRelayBridge(recordedOptions());
      const request = requestFor(leaves, arrives);
      const quote = successOf(await bridge.quote(request, live));
      const drafts = await bridge.build({ ...request, quote, minOut: quote.minOut }, live);
      expect(drafts).toHaveLength(2);
      expect(bridge.decode(draftAt(drafts, 0))).toStrictEqual(unknownCall);
      const decoded = successOf(bridge.decode(draftAt(drafts, 1)));
      expect(decoded).toStrictEqual({
        kind: "order",
        contract: depository,
        depositor: wallet,
        amountIn: request.amountIn,
        orderId: expect.stringMatching(/^0x[0-9a-f]{64}$/u) as string,
      });
      const record = z.looseObject({ orderId: z.string() }).parse(JSON.parse(String(quote.route)));
      expect(decoded).toMatchObject({ orderId: record.orderId });
    },
  );

  it("takes the recorded swaps into USDG under the input less the fees, within their route's cap", async () => {
    const bridge = createRelayBridge(recordedOptions());
    const fromUsdc = successOf(
      await bridge.quote(requestFor(tokens.usdc, tokens.robinhoodUsdg), live),
    );
    const fromUsdt = successOf(
      await bridge.quote(requestFor(tokens.usdt, tokens.robinhoodUsdg), live),
    );
    expect([fromUsdc.minOut.base, fromUsdt.minOut.base]).toStrictEqual([19_889_586n, 19_867_950n]);
  });

  it("refuses the same swaps on a route without a cap, which must pay exactly the input less the fees", async () => {
    const uncapped = recordedRoutes.map(({ leaves, arrives, decimals }) => ({
      leaves,
      arrives,
      decimals,
    }));
    const bridge = createRelayBridge({ ...recordedOptions(), routes: uncapped });
    await expect(
      bridge.quote(requestFor(tokens.usdt, tokens.robinhoodUsdg), live),
    ).rejects.toMatchObject({ code: "relay.bad_quote", details: { problem: "other_fees" } });
  });

  it("names Relay's page for a deposit without asking Relay", () => {
    const http = recordedApi();
    const page = createRelayBridge(recordedOptions(http)).pageOf(
      deposit(recordedDeposits.fillBase),
    );
    expect(page).toBe(`https://relay.link/transaction/${recordedDeposits.fillBase}`);
  });

  it("answers no_route for a recipient that is no account of the destination, and asks Relay nothing", async () => {
    const http = recordedApi();
    const bridge = createRelayBridge(recordedOptions(http));
    const evmOnSolana = {
      ...requestFor(tokens.usdc, tokens.solanaUsdc),
      recipient: accountRefSchema.parse(`${solana}:0x${"22".repeat(20)}`),
    };
    const otherChain = { ...requestFor(tokens.usdc, tokens.baseUsdc), recipient: wallet };
    await expect(bridge.quote(evmOnSolana, live)).resolves.toStrictEqual(noRoute);
    await expect(bridge.quote(otherChain, live)).resolves.toStrictEqual(noRoute);
    expect(http.requests()).toStrictEqual([]);
  });

  it("names an amount under or over Relay's limits", async () => {
    const bridge = createRelayBridge(recordedOptions());
    const request = requestFor(tokens.usdc, tokens.baseUsdc);
    const low = { ...request, amountIn: usdc(1_000n) };
    const high = { ...request, amountIn: usdc(10n ** 26n) };
    await expect(bridge.quote(low, live)).resolves.toStrictEqual({
      ok: false,
      error: "amount_too_low",
    });
    await expect(bridge.quote(high, live)).resolves.toStrictEqual({
      ok: false,
      error: "low_liquidity",
    });
  });

  it("takes a Solana fill as its deposit's own by the memo naming its order", () => {
    const bridge = createRelayBridge(recordedOptions());
    expect(bridge.settlement(recordedSolanaFillCheck)).toStrictEqual({
      ok: true,
      value: 2n ** 64n - 1n,
    });
  });

  it("tells the Solana fill of a deposit by its signature on Solana", async () => {
    const options = recordedOptions();
    const bridge = createRelayBridge({ ...options, routes: recordedRoutes });
    await expect(bridge.status(deposit(recordedDeposits.fillSolana), live)).resolves.toMatchObject({
      state: {
        kind: "filled",
        fill: {
          chain: solana,
          hash: "8uRCp3CjnvVSdQTfeiLaus8mMRYSng6otkhaR7SDiJUKugmjqW5zocNgfszsigUwpXx4G8pdUmp5XnkTsD3MDhE",
        },
      },
    });
  });

  it("refuses to load with a route from an undeclared chain or to a chain Relay names no id for", () => {
    const http = recordedApi();
    const clock = recordedOptions().clock;
    const depositories = { [bsc]: depository };
    const toNowhere = [
      {
        leaves: tokens.usdc,
        arrives: assetRefSchema.parse("eip155:10/erc20:0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85"),
        decimals: { leaves: 18, arrives: 6 },
      },
    ];
    expect(() =>
      createRelayBridge({ http, clock, chains: [bsc], routes: toNowhere, depositories }),
    ).toThrow(expect.objectContaining({ code: "relay.bad_options" }));
    expect(() =>
      createRelayBridge({ http, clock, chains: [base], routes: recordedRoutes, depositories }),
    ).toThrow(expect.objectContaining({ code: "relay.bad_options" }));
  });

  it("declares only the token deposit, a bridge wallet's alone, and its destinations by Relay's ids", () => {
    const [contracts] = relayDeclaration([bsc]).contracts;
    expect(contracts?.calls?.map((call) => [call.onlyWallet, call.walletInputs])).toStrictEqual([
      ["bridge", ["depositor"]],
    ]);
    expect(contracts?.onlyWalletSpenders).toStrictEqual({ bridge: ["depository"] });
    expect(contracts?.spenders).toBeUndefined();
    expect(createRelayBridge(recordedOptions()).destinations).toStrictEqual([
      { chain: base, id: "8453" },
      { chain: solana, id: "792703809" },
      { chain: chainRefSchema.parse("eip155:4663"), id: "4663" },
    ]);
  });
});
