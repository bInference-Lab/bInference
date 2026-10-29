import { BinferenceError, type JsonValue } from "@binference/core";
import type { EvaluationSkill } from "./bundled-skills.js";
import type { WorldBalance, WorldToken } from "./scenario.schema.js";

// The engine's computed answers in a scenario's world, as JSON carries them: tokens, balances in
// paper, and quotes from each token's USD price. Amounts are bigint until they go on the wire.

/** A JSON object as the engine sends it. */
export interface WireObject {
  readonly [key: string]: JsonValue;
}

function isList(value: JsonValue): value is readonly JsonValue[] {
  return Array.isArray(value);
}

/** A JSON value as an object: itself when it is one, else an object with no field. */
export function objectOf(value: JsonValue | undefined): WireObject {
  if (value === undefined || value === null || typeof value !== "object" || isList(value)) {
    return {};
  }
  return value;
}

/** The tokens, balances and skills one scenario's run reads, and its time. */
export interface WorldFacts {
  readonly tokens: readonly WorldToken[];
  readonly balances: readonly WorldBalance[];
  /** The bundled skills the agent's index holds. */
  readonly skills: readonly EvaluationSkill[];
  readonly wallet: string;
  readonly now: number;
}

/** Each asset's info as an answer carries it, for the tokens given. */
export function assetInfosOf(tokens: readonly WorldToken[]): WireObject {
  const entries = tokens.map((token): [string, JsonValue] => [
    token.asset,
    { symbol: token.symbol, name: token.name, decimals: token.decimals, verified: token.verified },
  ]);
  return Object.fromEntries(entries);
}

/** The token whose asset is `asset`, or `asset.not_found`, as the engine answers it. */
export function tokenOf(facts: WorldFacts, asset: JsonValue | undefined): WorldToken {
  const named = typeof asset === "string" ? asset : JSON.stringify(asset ?? null);
  const found = facts.tokens.find((token) => token.asset.toLowerCase() === named.toLowerCase());
  if (found === undefined) {
    throw new BinferenceError({
      code: "asset.not_found",
      message: `No token ${named} is known on this chain.`,
    });
  }
  return found;
}

/** A token's last risk check: its world's, or a pass with no flag. */
export function riskOf(token: WorldToken, now: number): WireObject {
  const { refusal: _refusal, ...risk } = token.risk ?? { verdict: "pass", flags: [] };
  return {
    ...risk,
    flags: risk.flags.map((flag) => ({ code: flag.code, source: flag.source })),
    onCurve: false,
    checkedAt: now,
  };
}

/** A token as `asset/get` and `asset/search` answer it. */
export function assetViewOf(token: WorldToken, now: number): WireObject {
  return {
    asset: token.asset,
    symbol: token.symbol,
    name: token.name,
    decimals: token.decimals,
    verified: token.verified,
    risk: riskOf(token, now),
  };
}

/** The tokens whose symbol, name or asset holds the query, ignoring case. */
export function searchOf(facts: WorldFacts, query: string): WireObject {
  const wanted = query.trim().toLowerCase();
  const items = facts.tokens.filter((token) =>
    [token.symbol, token.name, token.asset].some((field) => field.toLowerCase().includes(wanted)),
  );
  return { items: items.map((token) => assetViewOf(token, facts.now)) };
}

/** The USD value of an amount of a token, in micro-dollars. */
function usdOf(token: WorldToken, base: bigint): bigint {
  return (base * BigInt(token.priceUsdMicros)) / 10n ** BigInt(token.decimals);
}

/** The agent's paper portfolio: each balance with its USD value, and their total. */
export function portfolioOf(facts: WorldFacts): WireObject {
  const held = facts.balances.map((balance) => {
    const token = tokenOf(facts, factsAsset(facts, balance.token));
    const usd = usdOf(token, BigInt(balance.base));
    return { token, usd, base: balance.base };
  });
  const total = held.reduce((sum, item) => sum + item.usd, 0n);
  return {
    balances: held.map(({ token, usd, base }) => ({
      wallet: facts.wallet,
      amount: { asset: token.asset, base },
      usdMicros: usd.toString(),
      paper: true,
    })),
    positions: [],
    totalUsdMicros: "0",
    paperTotalUsdMicros: total.toString(),
    assets: assetInfosOf(held.map((item) => item.token)),
  };
}

// A balance names its token by key.
function factsAsset(facts: WorldFacts, key: string): string {
  return facts.tokens.find((token) => token.key === key)?.asset ?? key;
}

/** What the agent's wallet holds of an asset, in base units. */
function heldOf(facts: WorldFacts, asset: string): bigint {
  const held = facts.balances.find((balance) => factsAsset(facts, balance.token) === asset);
  return held === undefined ? 0n : BigInt(held.base);
}

/** An amount of `from` as the request gives it: base units, or a share of the balance. */
export function amountInOf(facts: WorldFacts, from: string, amount: JsonValue | undefined): bigint {
  const { base, percentBps } = objectOf(amount);
  if (typeof base === "string") {
    return BigInt(base);
  }
  const bps = typeof percentBps === "number" ? BigInt(percentBps) : 0n;
  return (heldOf(facts, from) * bps) / 10_000n;
}

/** What `base` of one token buys of another, at their USD prices. */
function amountOutOf(from: WorldToken, to: WorldToken, base: bigint): bigint {
  const scaled = base * BigInt(from.priceUsdMicros) * 10n ** BigInt(to.decimals);
  return scaled / (BigInt(to.priceUsdMicros) * 10n ** BigInt(from.decimals));
}

/** A quote of `base` of `from` for `to` on the evaluation's venue, with 0.5% below as its minimum. */
export function quoteOf(
  facts: WorldFacts,
  trade: { readonly from: WorldToken; readonly to: WorldToken; readonly base: bigint },
): WireObject {
  const out = amountOutOf(trade.from, trade.to, trade.base);
  const native = facts.tokens[0]?.asset ?? trade.from.asset;
  return {
    route: [{ venue: "evaluation-swap", shareBps: 10_000 }],
    amountIn: { asset: trade.from.asset, base: trade.base.toString() },
    expectedOut: { asset: trade.to.asset, base: out.toString() },
    minOut: { asset: trade.to.asset, base: ((out * 995n) / 1_000n).toString() },
    priceImpactBps: 10,
    gas: { asset: native, base: "60000000000000" },
    quotedAt: facts.now,
    expiresAt: facts.now + 30_000,
  };
}
