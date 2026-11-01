import { accountRefSchema } from "@binference/plugin-sdk";
import { createScriptedHttp, successOf } from "@binference/plugin-sdk/testing";
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { createAcrossBridge } from "../across-bridge.js";
import { createAcrossApi, swapUrlOf } from "../api/across-api.js";
import { editedAnswer } from "../testing/answer-edits.js";
import {
  bsc,
  recordedOptions,
  recordedRoutes,
  requestFor,
  tokens,
  spokePools,
} from "../testing/bridge-fixtures.js";
import { quoteBridge } from "./quote-bridge.js";
import { routeQueryOf } from "./route-query.js";

const live = { signal: new AbortController().signal };
const request = requestFor(tokens.usdc, tokens.baseUsdc);
const options = { http: createScriptedHttp([]), chains: [bsc], routes: recordedRoutes, spokePools };
const query = routeQueryOf(request, options)?.query;
const url = query === undefined ? "" : swapUrlOf(query);
// The recorded answer's input and the fees besides the relayer's, in BSC USDC's 18 decimals.
const inputAmount = 20n * 10n ** 18n;
const gasFee = 3_898_000_000_000_000n;
const scale = 10n ** 12n;

async function quoteWith(body: string) {
  const response = { status: 200, headers: {}, body };
  const api = createAcrossApi(createScriptedHttp([{ method: "GET", url, response }]));
  return await quoteBridge(request, { api, options }, live.signal);
}

const relayerFees = fc.bigInt({ min: 0n, max: 10n ** 18n });
const outputOf = (relayerFee: bigint): bigint => (inputAmount - relayerFee - gasFee) / scale;

describe("an Across quote's amounts", () => {
  it("are taken when the output is the input less the fees, in Base USDC's decimals", async () => {
    await fc.assert(
      fc.asyncProperty(relayerFees, async (relayerFee) => {
        const body = editedAnswer({ relayerFee, output: outputOf(relayerFee) });
        await expect(quoteWith(body)).resolves.toMatchObject({ ok: true });
      }),
      { numRuns: 40 },
    );
  });

  it("are refused when the output is anything else", async () => {
    const gaps = fc.bigInt({ min: -(10n ** 6n), max: 10n ** 6n }).filter((gap) => gap !== 0n);
    await fc.assert(
      fc.asyncProperty(relayerFees, gaps, async (relayerFee, gap) => {
        const body = editedAnswer({ relayerFee, output: outputOf(relayerFee) + gap });
        await expect(quoteWith(body)).rejects.toMatchObject({ code: "across.bad_quote" });
      }),
      { numRuns: 40 },
    );
  });
});

describe("an Across quote's build", () => {
  it("is refused for any other amount or recipient than the quote was given for", async () => {
    const bridge = createAcrossBridge(recordedOptions());
    const quote = successOf(await bridge.quote(request, live));
    const amounts = fc.bigInt({ min: 1n, max: 10n ** 30n }).filter((base) => base !== inputAmount);
    const recipients = fc
      .stringMatching(/^0x[0-9a-f]{40}$/)
      .map((address) => accountRefSchema.parse(`eip155:8453:${address}`))
      .filter((recipient) => recipient !== request.recipient);
    const changes = fc.oneof(
      amounts.map((base) => ({ amountIn: { asset: request.amountIn.asset, base } })),
      recipients.map((recipient) => ({ recipient })),
    );
    await fc.assert(
      fc.asyncProperty(changes, async (change) => {
        const built = bridge.build({ ...request, ...change, quote, minOut: quote.minOut }, live);
        await expect(built).rejects.toMatchObject({ code: "across.quote_mismatch" });
      }),
      { numRuns: 60 },
    );
  });
});
