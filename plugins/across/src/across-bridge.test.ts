import { accountRefSchema, chainRefSchema, type TxHash } from "@binference/plugin-sdk";
import { bridgeContract, draftAt, successOf } from "@binference/plugin-sdk/testing";
import { describe, expect, it } from "vitest";
import { acrossDeclaration, createAcrossBridge } from "./across-bridge.js";
import {
  base,
  bsc,
  recipientOn,
  recordedApi,
  recordedOptions,
  recordedExpired,
  recordedFill,
  recordedRefund,
  recordedRoutes,
  requestFor,
  spokePool,
  tokens,
  unseenDeposit,
  wallet,
} from "./testing/bridge-fixtures.js";

const live = { signal: new AbortController().signal };
const noRoute = { ok: false, error: "no_route" };
const unknownCall = { ok: false, error: "unknown_call" };
const solana = chainRefSchema.parse("solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp");
const deposit = (hash: string) => ({ chain: bsc, hash: hash as TxHash });
const usdc = (units: bigint) => ({ asset: tokens.usdc, base: units });

describe("the Across bridge", () => {
  it.each(
    bridgeContract({
      create: async () =>
        await Promise.resolve({
          bridge: createAcrossBridge(recordedOptions()),
          request: requestFor(tokens.usdc, tokens.baseUsdc),
          unserved: requestFor(tokens.usdc, tokens.robinhoodUsdg),
          otherRecipient: accountRefSchema.parse(
            "eip155:8453:0x3333333333333333333333333333333333333333",
          ),
          deposits: "bound",
          filled: {
            deposit: deposit(recordedFill.deposit),
            fill: { chain: base, hash: recordedFill.fill as TxHash },
          },
          refunded: {
            deposit: deposit(recordedRefund.deposit),
            refund: deposit(recordedRefund.refund),
          },
          expired: deposit(recordedExpired),
          unseen: deposit(unseenDeposit),
        }),
    }),
  )("follows the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });

  it("quotes the recorded USDC route to Base with Across's fee, time and expiry", async () => {
    const quote = await createAcrossBridge(recordedOptions()).quote(
      requestFor(tokens.usdc, tokens.baseUsdc),
      live,
    );
    expect(quote).toStrictEqual({
      ok: true,
      value: {
        expectedOut: { asset: tokens.baseUsdc, base: 19_972_096n },
        minOut: { asset: tokens.baseUsdc, base: 19_972_096n },
        fees: [
          { kind: "bridge", amount: usdc(0n) },
          { kind: "relayer", amount: usdc(24_006_000_000_000_000n) },
          { kind: "gas", amount: usdc(3_898_000_000_000_000n) },
        ],
        etaSeconds: 2,
        quotedAtMs: 1_793_528_627_000,
        expiresAtMs: 1_793_532_227_000,
        route: expect.any(String) as string,
      },
    });
  });

  it.each(recordedRoutes)(
    "builds a depositV3 of $leaves that decodes to its card's terms",
    async ({ leaves, arrives }) => {
      const bridge = createAcrossBridge(recordedOptions());
      const request = requestFor(leaves, arrives);
      const quote = successOf(await bridge.quote(request, live));
      const { minOut } = quote;
      const drafts = await bridge.build({ ...request, quote, minOut }, live);
      expect(drafts).toHaveLength(2);
      expect(bridge.decode(draftAt(drafts, 0))).toStrictEqual(unknownCall);
      expect(bridge.decode(draftAt(drafts, 1))).toStrictEqual({
        ok: true,
        value: {
          kind: "bound",
          contract: spokePool,
          depositor: wallet,
          recipient: request.recipient,
          amountIn: request.amountIn,
          minOut,
          fillDeadlineMs: expect.any(Number) as number,
        },
      });
    },
  );

  it("answers no_route for a Solana recipient and asks Across nothing", async () => {
    const http = recordedApi();
    const request = {
      ...requestFor(tokens.usdc, tokens.solanaUsdc),
      recipient: recipientOn(solana),
    };
    await expect(
      createAcrossBridge(recordedOptions(http)).quote(request, live),
    ).resolves.toStrictEqual(noRoute);
    expect(http.requests()).toStrictEqual([]);
  });

  it("answers no_route for an ETH route while the ceiling names no ETH cap", async () => {
    const http = recordedApi();
    const request = {
      ...requestFor(tokens.eth, tokens.baseWeth),
      cappedAssets: [tokens.usdc, tokens.usdt],
    };
    await expect(
      createAcrossBridge(recordedOptions(http)).quote(request, live),
    ).resolves.toStrictEqual(noRoute);
    expect(http.requests()).toStrictEqual([]);
  });

  it("answers no_route for a recipient on another chain than the delivered token", async () => {
    const request = { ...requestFor(tokens.usdc, tokens.baseUsdc), recipient: recipientOn(bsc) };
    await expect(createAcrossBridge(recordedOptions()).quote(request, live)).resolves.toStrictEqual(
      noRoute,
    );
  });

  it("tells a refunded deposit's refund on BNB Smart Chain and an expired one", async () => {
    const bridge = createAcrossBridge(recordedOptions());
    await expect(bridge.status(deposit(recordedRefund.deposit), live)).resolves.toStrictEqual({
      state: { kind: "refunded", refund: { chain: bsc, hash: recordedRefund.refund } },
      statusUrl: `https://across.to/transfer/${recordedRefund.deposit}`,
    });
    await expect(bridge.status(deposit(recordedExpired), live)).resolves.toMatchObject({
      state: { kind: "expired" },
    });
  });

  it("refuses to load with a route to a chain outside EIP-155 or from an undeclared chain", () => {
    const http = recordedApi();
    const decimals = { leaves: 18, arrives: 6 };
    const toSolana = [{ leaves: tokens.usdc, arrives: tokens.solanaUsdc, decimals }];
    expect(() => createAcrossBridge({ http, chains: [bsc], routes: toSolana })).toThrow(
      expect.objectContaining({ code: "across.bad_options" }),
    );
    expect(() => createAcrossBridge({ http, chains: [base], routes: recordedRoutes })).toThrow(
      expect.objectContaining({ code: "across.bad_options" }),
    );
  });

  it("declares depositV3 on the SpokePool, its bound inputs, the one spender, and its destinations", () => {
    const declared = acrossDeclaration([bsc]);
    expect(declared.contracts[0]?.calls?.map((call) => call.bridge)).toStrictEqual([
      {
        recipient: "recipient",
        destinationChain: "destinationChainId",
        tokenIn: "inputToken",
        tokenOut: "outputToken",
        minOut: "outputAmount",
        emptyInputs: ["message"],
      },
    ]);
    expect(declared.contracts[0]?.spenders).toStrictEqual(["spoke-pool"]);
    expect(createAcrossBridge(recordedOptions()).destinations.map((item) => item.id)).toStrictEqual(
      ["8453", "1", "42161", "4663"],
    );
  });
});
