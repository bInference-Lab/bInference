import { accountRefSchema, type TxHash } from "@binference/plugin-sdk";
import { encodeEvmApproval, encodeEvmDraft } from "@binference/plugin-sdk/evm";
import { draftAt, successOf } from "@binference/plugin-sdk/testing";
import { concat } from "viem";
import { describe, expect, it } from "vitest";
import { requestsUrlOf } from "../api/relay-api.js";
import { createRelayBridge } from "../relay-bridge.js";
import {
  base,
  bsc,
  depository,
  recordedApi,
  recordedDeposits,
  recordedOptions,
  requestFor,
  tokens,
  wallet,
} from "../testing/bridge-fixtures.js";
import fillBase from "../testing/recorded/request-fill-base.json" with { type: "json" };
import { encodeDepositErc20 } from "./deposit-call.js";

const live = { signal: new AbortController().signal };
const unknownCall = { ok: false, error: "unknown_call" };
const deposit = (hash: string) => ({ chain: bsc, hash: hash as TxHash });
const terms = {
  depositor: "0x1111111111111111111111111111111111111111",
  token: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d",
  amount: 20n * 10n ** 18n,
  orderId: `0x${"ab".repeat(32)}`,
} as const;

// The recorded fill to Base, its transaction on Base, and the request with a transaction on BNB
// Smart Chain named before it, as one that tops up gas would be.
const baseFillHash = "0xc271169154e8dbd4805b0ce299060677b1ae2ded518335eb298ee00cd764a82f";

function withTopUp(): typeof fillBase {
  const answer = structuredClone(fillBase);
  for (const request of answer.requests) {
    const outTxs = request.data.outTxs.flatMap((fill) => [
      { ...fill, chainId: 56, hash: `0x${"77".repeat(32)}` },
      fill,
    ]);
    Object.assign(request.data, { outTxs });
  }
  return answer;
}

async function quoted() {
  const bridge = createRelayBridge(recordedOptions());
  const request = requestFor(tokens.usdc, tokens.baseUsdc);
  const quote = successOf(await bridge.quote(request, live));
  return { bridge, request, quote };
}

describe("a Relay deposit", () => {
  it("decodes only depositErc20 from its own depositor, with no coin and nothing appended", () => {
    const bridge = createRelayBridge(recordedOptions());
    const own = encodeEvmDraft({
      from: wallet,
      to: depository,
      value: 0n,
      data: encodeDepositErc20(terms),
    });
    expect(successOf(bridge.decode(own))).toMatchObject({ kind: "order", orderId: terms.orderId });
    const other = accountRefSchema.parse(`${bsc}:0x${"55".repeat(20)}`);
    const variants = [
      encodeEvmDraft({ from: other, to: depository, value: 0n, data: encodeDepositErc20(terms) }),
      encodeEvmDraft({ from: wallet, to: depository, value: 1n, data: encodeDepositErc20(terms) }),
      encodeEvmDraft({
        from: wallet,
        to: depository,
        value: 0n,
        data: concat([encodeDepositErc20(terms), "0x00"]),
      }),
    ];
    for (const draft of variants) {
      expect(bridge.decode(draft)).toStrictEqual(unknownCall);
    }
  });

  it("builds nothing from a quote with no record, or one paying less than the host's least", async () => {
    const { bridge, request, quote } = await quoted();
    const { route: _route, ...unrecorded } = quote;
    await expect(
      bridge.build({ ...request, quote: unrecorded, minOut: quote.minOut }, live),
    ).rejects.toMatchObject({ code: "relay.bad_quote" });
    const more = { ...quote.minOut, base: quote.minOut.base + 1n };
    await expect(bridge.build({ ...request, quote, minOut: more }, live)).rejects.toMatchObject({
      code: "relay.below_min",
    });
    const solana = { ...request, recipient: accountRefSchema.parse(`${bsc}:0x${"22".repeat(20)}`) };
    await expect(
      bridge.build({ ...solana, quote, minOut: quote.minOut }, live),
    ).rejects.toMatchObject({
      code: "relay.no_route",
    });
  });

  it("approves exactly the input to the depository before it deposits", async () => {
    const { bridge, request, quote } = await quoted();
    const drafts = await bridge.build({ ...request, quote, minOut: quote.minOut }, live);
    const approval = draftAt(drafts, 0);
    expect(approval).toStrictEqual(
      encodeEvmApproval({
        wallet,
        token: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d",
        spender: "0x4cD00E387622C35bDDB9b4c962C136462338BC31",
        amountBase: request.amountIn.base,
      }),
    );
  });
});

describe("a Relay deposit's status", () => {
  it("tells a refund on BNB Smart Chain by Relay's request, with Relay's page for it", async () => {
    const bridge = createRelayBridge(recordedOptions());
    await expect(bridge.status(deposit(recordedDeposits.refund), live)).resolves.toStrictEqual({
      state: {
        kind: "refunded",
        refund: deposit("0x9b79626d1690f2e447db3cb3fcb0899be04f5485bd2f952aa9b2f3a267995b34"),
      },
      statusUrl:
        "https://relay.link/transaction/0x1793546957a02a9ebfbdff424270bd830c744bcc539de240e5a623890fc7b9c1",
    });
  });

  it("tells a success that names two transactions by the one on its destination", async () => {
    const response = { status: 200, headers: {}, body: JSON.stringify(withTopUp()) };
    const url = requestsUrlOf(recordedDeposits.fillBase, { keyed: false });
    const http = recordedApi([{ method: "GET", url, response }]);
    const bridge = createRelayBridge(recordedOptions(http));
    await expect(bridge.status(deposit(recordedDeposits.fillBase), live)).resolves.toMatchObject({
      state: { kind: "filled", fill: { chain: base, hash: baseFillHash } },
    });
  });

  it("tells a failed fill no refund follows as past its fill", async () => {
    const bridge = createRelayBridge(recordedOptions());
    await expect(bridge.status(deposit(recordedDeposits.expired), live)).resolves.toMatchObject({
      state: { kind: "expired" },
    });
  });

  it("tells an unseen deposit with Relay's page for its transaction", async () => {
    const bridge = createRelayBridge(recordedOptions());
    await expect(bridge.status(deposit(recordedDeposits.unseen), live)).resolves.toStrictEqual({
      state: { kind: "unseen" },
      statusUrl: `https://relay.link/transaction/${recordedDeposits.unseen}`,
    });
  });

  it("refuses a deposit named by no 32-byte hash", async () => {
    const bridge = createRelayBridge(recordedOptions());
    await expect(bridge.status(deposit("abc"), live)).rejects.toMatchObject({
      code: "relay.not_evm",
    });
  });
});
