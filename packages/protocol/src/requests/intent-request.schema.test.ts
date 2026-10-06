import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ids, nativeAmount, refs, swapRequest } from "../examples/wire-values.js";
import { intentRequestSchema, readIntentRequestSchema } from "./intent-request.schema.js";

const base = { agent: ids.agent, wallet: ids.wallet, reason: "Owner asked for it." };

const requests = [
  ["swap", swapRequest],
  ["buy", { ...base, kind: "buy", token: refs.token, spend: nativeAmount, maxSlippageBps: 300 }],
  [
    "sell",
    {
      ...base,
      kind: "sell",
      token: refs.token,
      amount: { percentBps: 5_000 },
      receive: refs.native,
    },
  ],
  [
    "send to an address",
    { ...base, kind: "send", amount: nativeAmount, to: { address: refs.account } },
  ],
  ["send to a name", { ...base, kind: "send", amount: nativeAmount, to: { name: "owner.bnb" } }],
  [
    "send to a saved address",
    { ...base, kind: "send", amount: nativeAmount, to: { entry: ids.entry } },
  ],
  ["revokeApproval", { ...base, kind: "revokeApproval", token: refs.token, spender: refs.account }],
  ["lend", { ...base, kind: "lend", action: "repay", venue: "fake-lend", amount: nativeAmount }],
  [
    "stake",
    { ...base, kind: "stake", action: "claim", venue: "fake-stake", validator: refs.account },
  ],
  [
    "bridge",
    { ...base, kind: "bridge", amount: nativeAmount, toChain: "fake:2", to: { rescue: true } },
  ],
  [
    "cexOrder",
    {
      ...base,
      kind: "cexOrder",
      market: "TKNUSDT",
      side: "buy",
      type: "limit",
      size: "0.5",
      price: "612.25",
    },
  ],
  ["registerIdentity", { ...base, kind: "registerIdentity" }],
  [
    "launchToken",
    {
      ...base,
      kind: "launchToken",
      venue: "fake-pad",
      name: "Token",
      symbol: "TKN",
      image: "upload-1",
      description: "A test token.",
      links: { website: "https://example.invalid", x: "https://x.example.invalid/tkn" },
      pairWith: refs.native,
      firstBuy: nativeAmount,
      venueOptions: { taxBps: 100 },
    },
  ],
] as const;

describe("intentRequestSchema", () => {
  it.each(requests)("decodes a %s request and encodes it back unchanged", (_name, request) => {
    expect(z.encode(intentRequestSchema, z.decode(intentRequestSchema, request))).toStrictEqual(
      request,
    );
  });

  it("decodes amounts into bigints", () => {
    expect(intentRequestSchema.parse(swapRequest)).toMatchObject({
      amount: { base: 1_500_000_000_000_000_000n },
    });
  });

  it.each([
    ["an unknown field", { ...swapRequest, deadline: 60 }],
    ["an unknown kind", { ...swapRequest, kind: "perp" }],
    ["no reason", { ...swapRequest, reason: "" }],
    ["an amount as a number", { ...swapRequest, amount: { base: 1.5 } }],
    [
      "an amount in base units and a share at once",
      { ...swapRequest, amount: { base: "1", percentBps: 1 } },
    ],
    ["a slippage above 100%", { ...swapRequest, maxSlippageBps: 10_001 }],
    [
      "a send to two targets",
      { ...base, kind: "send", amount: nativeAmount, to: { name: "a.bnb", entry: ids.entry } },
    ],
    [
      "a bridge to an address",
      {
        ...base,
        kind: "bridge",
        amount: nativeAmount,
        toChain: "fake:2",
        to: { address: refs.account },
      },
    ],
    [
      "a venue id with capitals",
      { ...base, kind: "lend", action: "supply", venue: "Fake", amount: nativeAmount },
    ],
    [
      "a launch link over plain http",
      {
        ...base,
        kind: "launchToken",
        venue: "fake-pad",
        name: "T",
        symbol: "T",
        image: "u",
        pairWith: refs.native,
        links: { website: "http://example.invalid" },
      },
    ],
  ] as const)("refuses %s", (_name, request) => {
    expect(intentRequestSchema.safeParse(request).success).toBe(false);
  });

  it("reads a stored request with a field a newer engine adds, and drops the field", () => {
    expect(readIntentRequestSchema.parse({ ...swapRequest, deadline: 60 })).not.toHaveProperty(
      "deadline",
    );
  });
});
