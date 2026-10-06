// Example wire values on the fake chain of `@binference/chain`'s fakes, for the operation examples.

/** A JSON value as it travels on the wire. */
export type WireValue =
  | string
  | number
  | boolean
  | readonly WireValue[]
  | { readonly [key: string]: WireValue };

/** A JSON object as it travels on the wire. */
export type WireObject = Readonly<Record<string, WireValue>>;

/** An example call of one operation: its args and its result, as JSON carries them. */
export interface WireExample {
  readonly args: WireValue;
  readonly result: WireValue;
}

const uuid = "0190f1c2-3a4b-7c5d-8e6f-0123456789ab";

type IdName =
  | "agent"
  | "wallet"
  | "intent"
  | "card"
  | "entry"
  | "token"
  | "job"
  | "order"
  | "fill"
  | "alert"
  | "rule"
  | "schedule"
  | "session"
  | "turn"
  | "device"
  | "backup"
  | "plugin"
  | "ledgerEntry";

/** An example id of every kind the operations name. */
export const ids: Readonly<Record<IdName, string>> = {
  agent: `agt_${uuid}`,
  wallet: `wal_${uuid}`,
  intent: `int_${uuid}`,
  card: `crd_${uuid}`,
  entry: `adr_${uuid}`,
  token: `tok_${uuid}`,
  job: `job_${uuid}`,
  order: `ord_${uuid}`,
  fill: `fil_${uuid}`,
  alert: `alr_${uuid}`,
  rule: `whr_${uuid}`,
  schedule: `sch_${uuid}`,
  session: `ses_${uuid}`,
  turn: `trn_${uuid}`,
  device: `dev_${uuid}`,
  backup: `bkp_${uuid}`,
  plugin: `plg_${uuid}`,
  ledgerEntry: `led_${uuid}`,
};

/** Example chain, asset and account refs. */
export const refs: Readonly<Record<"chain" | "native" | "token" | "account", string>> = {
  chain: "fake:1",
  native: "fake:1/slip44:1",
  token: "fake:1/token:0x0000000a",
  account: "fake:1:0x0000000c",
};

/** An example time, epoch milliseconds. */
export const at: number = 1_760_000_000_000;

/** An example amount of the native asset. */
export const nativeAmount: WireObject = { asset: refs.native, base: "1500000000000000000" };

const tokenAmount: WireObject = { asset: refs.token, base: "500000000" };

/** The info of both example assets. */
export const assets: WireObject = {
  [refs.native]: { symbol: "FAKE", name: "Fake", decimals: 18, verified: true },
  [refs.token]: {
    symbol: "TKN",
    name: "Token",
    decimals: 6,
    verified: false,
    onCurve: true,
    logo: "https://example.invalid/tkn.png",
  },
};

/** An example risk check. */
export const riskView: WireObject = {
  verdict: "warn",
  flags: [{ code: "high_tax", source: "goplus" }],
  buyTaxBps: 300,
  sellTaxBps: 500,
  liquidityUsdMicros: "25000000000",
  onCurve: false,
  checkedAt: at,
};

/** An example quote. */
export const quoteView: WireObject = {
  route: [{ venue: "fake-swap", shareBps: 10_000 }],
  amountIn: nativeAmount,
  expectedOut: tokenAmount,
  minOut: { asset: refs.token, base: "495000000" },
  priceImpactBps: 12,
  gas: { asset: refs.native, base: "21000000000000" },
  quotedAt: at,
  expiresAt: at + 10_000,
};

/** An example swap request. */
export const swapRequest: WireObject = {
  kind: "swap",
  agent: ids.agent,
  reason: "Rotate into the token after the breakout.",
  from: refs.native,
  to: refs.token,
  amount: { base: "1500000000000000000" },
  maxSlippageBps: 50,
};

/** An example intent: a confirmed swap with its card and one fill. */
export const intentView: WireObject = {
  intent: ids.intent,
  agent: ids.agent,
  wallet: ids.wallet,
  kind: "swap",
  state: "reconciled",
  request: swapRequest,
  quote: quoteView,
  risk: riskView,
  simulation: { spent: [nativeAmount], received: [tokenAmount], simulatedAt: at },
  card: {
    card: ids.card,
    version: 2,
    opensAt: at,
    expiresAt: at + 60_000,
    paper: false,
    outsideContent: true,
  },
  outcome: {
    txHashes: ["0xabc123"],
    executions: [
      {
        amountIn: nativeAmount,
        amountOut: tokenAmount,
        priceUsdMicros: "600000000",
        feeUsdMicros: "1000",
        gasUsdMicros: "12000",
        at,
      },
    ],
  },
  paper: false,
  outsideContent: true,
  createdAt: at,
  changedAt: at + 1_000,
  assets,
};

/** An example agent. */
export const agentView: WireObject = {
  agent: ids.agent,
  name: "Scout",
  mode: "paper",
  locale: "zh",
  frozenAt: at,
  createdAt: at,
  changedAt: at,
};

/** An example wallet. */
export const walletView: WireObject = {
  wallet: ids.wallet,
  agent: ids.agent,
  address: refs.account,
  label: "Main",
  createdAt: at,
};

/** An example portfolio with a loss on its position. */
export const portfolioView: WireObject = {
  balances: [
    { wallet: ids.wallet, amount: nativeAmount, usdMicros: "900000000", paper: true },
    { wallet: ids.wallet, amount: tokenAmount, paper: true },
  ],
  positions: [
    {
      wallet: ids.wallet,
      asset: refs.token,
      quantity: "500000000",
      costUsdMicros: "510000000",
      realizedUsdMicros: "0",
      unrealizedUsdMicros: "-12500000",
      paper: true,
    },
  ],
  totalUsdMicros: "900000000",
  assets,
};

/** Wraps items as one page of a list. */
export function pageOf(...items: readonly WireValue[]): WireValue {
  return { items, next: "cursor-2" };
}
