import type { ChainDefinition } from "@binference/chain";
import { z } from "zod";
import { readParsed } from "./live-parts.mjs";
import type { ReportedFill } from "./read-evm-chain.mjs";

const acrossDepositsSchema = z.array(
  z.looseObject({
    status: z.string(),
    outputToken: z.string(),
    outputAmount: z.string(),
    recipient: z.string(),
    fillTx: z.string().nullable().optional(),
    message: z.string().optional(),
  }),
);

const relayRequestsSchema = z.looseObject({
  requests: z.array(
    z.looseObject({
      status: z.string(),
      data: z.looseObject({
        metadata: z.looseObject({
          recipient: z.string(),
          currencyOut: z.looseObject({
            amount: z.string(),
            currency: z.looseObject({ address: z.string() }),
          }),
        }),
        outTxs: z.array(z.looseObject({ hash: z.string() })).default([]),
      }),
    }),
  ),
});

// A registry token, or the zero address that stands for the chain's coin in both bridges' APIs.
const listed = (definition: ChainDefinition, token: string): boolean =>
  token === "0x0000000000000000000000000000000000000000" ||
  definition.tokens.some(({ address }) => address.toLowerCase() === token.toLowerCase());

/** The newest Across fill from BSC to the chain in one of its registry tokens. */
export async function acrossFill(
  definition: ChainDefinition,
  chainId: number,
): Promise<ReportedFill[]> {
  const url = `https://app.across.to/api/deposits?originChainId=56&destinationChainId=${String(chainId)}&status=filled&limit=20`;
  const deposits = await readParsed(acrossDepositsSchema, url);
  // A deposit with a message runs actions on arrival, such as a swap into another token, so the
  // recipient may never hold the output token; only plain fills are read.
  const fill = deposits.find(
    ({ outputToken, fillTx, message }) =>
      listed(definition, outputToken) && typeof fillTx === "string" && message === "0x",
  );
  return fill === undefined || typeof fill.fillTx !== "string"
    ? []
    : [
        {
          bridge: "Across",
          hash: fill.fillTx,
          recipient: fill.recipient,
          token: fill.outputToken,
          amount: BigInt(fill.outputAmount),
        },
      ];
}

/**
 * The three newest Relay fills from BSC to the chain in one of its registry tokens. Relay's
 * requests do not say whether the recipient is an app that passes the tokens on, so each is read.
 */
export async function relayFill(
  definition: ChainDefinition,
  chainId: number,
): Promise<ReportedFill[]> {
  const url = `https://api.relay.link/requests/v2?originChainId=56&destinationChainId=${String(chainId)}&limit=20`;
  // Relay's keyless requests endpoint is v2, rate limited in stages until it retires on
  // 2026-11-24; v3 needs an API key.
  const { requests } = await readParsed(relayRequestsSchema, url);
  return requests
    .filter(
      ({ status, data }) =>
        status === "success" &&
        data.outTxs[0] !== undefined &&
        listed(definition, data.metadata.currencyOut.currency.address),
    )
    .slice(0, 3)
    .map(({ data }) => ({
      bridge: "Relay",
      hash: data.outTxs[0]?.hash ?? "",
      recipient: data.metadata.recipient,
      token: data.metadata.currencyOut.currency.address,
      amount: BigInt(data.metadata.currencyOut.amount),
    }));
}
