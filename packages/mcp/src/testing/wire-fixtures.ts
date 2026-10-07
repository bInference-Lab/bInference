import { type IntentState, operations, type ResultOf } from "@binference/protocol";

// Example values on the fake chain of `@binference/chain`'s fakes, as the engine sends them.
const uuid = "0190f1c2-3a4b-7c5d-8e6f-0123456789ab";
const native = "fake:1/slip44:1";
const token = "fake:1/token:0x0000000a";
const at = 1_760_000_000_000;

/** The ids the fixtures use. */
export const fixtureIds: Readonly<Record<"agent" | "wallet" | "intent", string>> = {
  agent: `agt_${uuid}`,
  wallet: `wal_${uuid}`,
  intent: `int_${uuid}`,
};

/** A swap request as an MCP client sends it: 1.5 of the native asset for the token. */
export const swapArgs: Readonly<
  Record<string, string | number | Readonly<Record<string, string>>>
> = {
  kind: "swap",
  agent: fixtureIds.agent,
  reason: "Rotate into the token after the breakout.",
  from: native,
  to: token,
  amount: { base: "1500000000000000000" },
  maxSlippageBps: 50,
};

const assets = {
  [native]: { symbol: "FAKE", name: "Fake", decimals: 18, verified: true },
  [token]: { symbol: "TKN", name: "Token", decimals: 6, verified: false },
};

/** The intent the engine answers a swap proposal with, in a state with an optional reason. */
export function proposedIntent(state: IntentState, reason?: string): ResultOf<"intent/propose"> {
  return operations["intent/propose"].result.parse({
    intent: fixtureIds.intent,
    agent: fixtureIds.agent,
    wallet: fixtureIds.wallet,
    kind: "swap",
    state,
    request: swapArgs,
    ...(reason === undefined ? {} : { outcome: { reason } }),
    paper: true,
    outsideContent: false,
    createdAt: at,
    changedAt: at,
    assets,
  });
}

/** A portfolio of one wallet holding 1.5 of the native asset. */
export function portfolio(): ResultOf<"portfolio/get"> {
  return operations["portfolio/get"].result.parse({
    balances: [
      {
        wallet: fixtureIds.wallet,
        amount: { asset: native, base: "1500000000000000000" },
        usdMicros: "900000000",
        paper: true,
      },
    ],
    positions: [],
    totalUsdMicros: "900000000",
    assets,
  });
}
