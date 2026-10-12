import type { RuntimeModelPrice, RuntimeProvider } from "../control/runtime-settings.schema.js";

/**
 * What a model charges, in micro-dollars per million tokens: input not read from a cache, input
 * read from it (`cachedPerMTokUsd`), and output. A cache write costs `cacheWritePerMTokUsd`, or
 * 1.25 times the input price when it is absent: the price both Anthropic and OpenAI list for a
 * prompt prefix written to their 5-minute cache. A model with a price for long prompts charges it
 * for a call whose input, cached or not, is over `overTokens`.
 */
export interface ModelPrice extends RuntimeModelPrice {
  readonly cacheWritePerMTokUsd?: bigint;
  readonly longPrompt?: { readonly overTokens: number; readonly price: RuntimeModelPrice };
}

/** Where a model's price came from: the config's `models.prices`, or the built-in table. */
export type PriceSource = "config" | "built_in";

// Micro-dollars per million tokens: $1 per million tokens is 1_000_000n.
function priced(input: bigint, cached: bigint, output: bigint): RuntimeModelPrice {
  return { inputPerMTokUsd: input, cachedPerMTokUsd: cached, outputPerMTokUsd: output };
}

function withLongPrompt(
  price: RuntimeModelPrice,
  overTokens: number,
  long: RuntimeModelPrice,
): ModelPrice {
  return { ...price, longPrompt: { overTokens, price: long } };
}

/**
 * Anthropic's list prices, from https://platform.claude.com/docs/en/about-claude/pricing as read on
 * 2026-10-12, by Claude API model id. A cache write is the 5-minute write, 1.25 times the input
 * price for every model; Claude Haiku 5.5 charges more for a prompt over 100,000 tokens, counting
 * cache reads and writes. Models the page lists as retired or of limited availability are left
 * out.
 */
const anthropicPrices: ReadonlyMap<string, ModelPrice> = new Map([
  ["claude-fable-5-1", priced(10_000_000n, 250_000n, 50_000_000n)],
  ["claude-fable-5", priced(10_000_000n, 1_000_000n, 50_000_000n)],
  ["claude-opus-5-5", priced(4_000_000n, 200_000n, 20_000_000n)],
  ["claude-opus-5", priced(5_000_000n, 500_000n, 25_000_000n)],
  ["claude-opus-4-8", priced(5_000_000n, 500_000n, 25_000_000n)],
  ["claude-opus-4-7", priced(5_000_000n, 500_000n, 25_000_000n)],
  ["claude-opus-4-6", priced(5_000_000n, 500_000n, 25_000_000n)],
  ["claude-opus-4-5", priced(5_000_000n, 500_000n, 25_000_000n)],
  ["claude-sonnet-5-5", priced(2_000_000n, 100_000n, 10_000_000n)],
  ["claude-sonnet-5", priced(2_000_000n, 200_000n, 10_000_000n)],
  ["claude-sonnet-4-6", priced(3_000_000n, 300_000n, 15_000_000n)],
  ["claude-sonnet-4-5", priced(3_000_000n, 300_000n, 15_000_000n)],
  [
    "claude-haiku-5-5",
    withLongPrompt(
      priced(100_000n, 10_000n, 500_000n),
      100_000,
      priced(500_000n, 50_000n, 2_500_000n),
    ),
  ],
  ["claude-haiku-4-5", priced(1_000_000n, 100_000n, 5_000_000n)],
]);

// OpenAI's long-context tier: input over 272K tokens.
const openAiLongContext = 272_000;

/**
 * OpenAI's Standard list prices for text tokens, from https://developers.openai.com/api/docs/pricing
 * as read on 2026-10-12, by model id: input, cached input and output, and the long-context tier
 * where the page lists one. Models with no cached input price are left out, but for a snapshot that
 * would otherwise take its alias's price. Chat Completions
 * reports no cache writes, so their input counts at the input price.
 */
const openAiPrices: ReadonlyMap<string, ModelPrice> = new Map([
  [
    "gpt-6-astra",
    withLongPrompt(
      priced(10_000_000n, 1_000_000n, 50_000_000n),
      openAiLongContext,
      priced(20_000_000n, 2_000_000n, 75_000_000n),
    ),
  ],
  [
    "gpt-6.1-sol",
    withLongPrompt(
      priced(2_000_000n, 100_000n, 10_000_000n),
      openAiLongContext,
      priced(4_000_000n, 200_000n, 15_000_000n),
    ),
  ],
  [
    "gpt-6-sol",
    withLongPrompt(
      priced(2_000_000n, 200_000n, 10_000_000n),
      openAiLongContext,
      priced(4_000_000n, 400_000n, 15_000_000n),
    ),
  ],
  [
    "gpt-6-luna",
    withLongPrompt(
      priced(100_000n, 10_000n, 500_000n),
      openAiLongContext,
      priced(200_000n, 20_000n, 750_000n),
    ),
  ],
  [
    "gpt-5.6-sol",
    withLongPrompt(
      priced(4_000_000n, 400_000n, 20_000_000n),
      openAiLongContext,
      priced(8_000_000n, 800_000n, 30_000_000n),
    ),
  ],
  [
    "gpt-5.6-terra",
    withLongPrompt(
      priced(2_000_000n, 200_000n, 12_000_000n),
      openAiLongContext,
      priced(4_000_000n, 400_000n, 18_000_000n),
    ),
  ],
  [
    "gpt-5.6-luna",
    withLongPrompt(
      priced(200_000n, 20_000n, 1_200_000n),
      openAiLongContext,
      priced(400_000n, 40_000n, 1_800_000n),
    ),
  ],
  [
    "gpt-5.5",
    withLongPrompt(
      priced(5_000_000n, 500_000n, 30_000_000n),
      openAiLongContext,
      priced(10_000_000n, 1_000_000n, 45_000_000n),
    ),
  ],
  [
    "gpt-5.4",
    withLongPrompt(
      priced(2_500_000n, 250_000n, 15_000_000n),
      openAiLongContext,
      priced(5_000_000n, 500_000n, 22_500_000n),
    ),
  ],
  ["gpt-5.4-mini", priced(750_000n, 75_000n, 4_500_000n)],
  ["gpt-5.4-nano", priced(200_000n, 20_000n, 1_250_000n)],
  ["gpt-5.2", priced(1_750_000n, 175_000n, 14_000_000n)],
  ["gpt-5.1", priced(1_250_000n, 125_000n, 10_000_000n)],
  ["gpt-5", priced(1_250_000n, 125_000n, 10_000_000n)],
  ["gpt-5-mini", priced(250_000n, 25_000n, 2_000_000n)],
  ["gpt-5-nano", priced(50_000n, 5_000n, 400_000n)],
  ["gpt-4.1", priced(2_000_000n, 500_000n, 8_000_000n)],
  ["gpt-4.1-mini", priced(400_000n, 100_000n, 1_600_000n)],
  ["gpt-4.1-nano", priced(100_000n, 25_000n, 400_000n)],
  ["gpt-4o", priced(2_500_000n, 1_250_000n, 10_000_000n)],
  ["gpt-4o-mini", priced(150_000n, 75_000n, 600_000n)],
  // A snapshot with a price of its own, and no cached input price: cached input counts as input.
  ["gpt-4o-2024-05-13", priced(5_000_000n, 5_000_000n, 15_000_000n)],
  ["o3", priced(2_000_000n, 500_000n, 8_000_000n)],
  ["o4-mini", priced(1_100_000n, 275_000n, 4_400_000n)],
]);

// A dated snapshot of a model costs what its alias costs: `claude-haiku-4-5-20251001` or
// `gpt-4.1-2025-04-14`. A snapshot the table lists under its own id keeps its own price.
const snapshotDate = /-(?:\d{8}|\d{4}-\d{2}-\d{2})$/;

function fromTable(table: ReadonlyMap<string, ModelPrice>, id: string): ModelPrice | undefined {
  return table.get(id) ?? table.get(id.replace(snapshotDate, ""));
}

/**
 * The built-in price of a model, by its provider's kind and its id at the provider, or `undefined`
 * when the table has none. The `binference` gateway reports each call's cost itself, so it needs
 * no table.
 */
export function builtInPrice(kind: RuntimeProvider["kind"], id: string): ModelPrice | undefined {
  if (kind === "anthropic") {
    return fromTable(anthropicPrices, id);
  }
  return kind === "openai" ? fromTable(openAiPrices, id) : undefined;
}

/** What a model's price is looked up in: its provider's kind and the config's prices. */
export interface PriceBook {
  readonly providers: Readonly<Record<string, Pick<RuntimeProvider, "kind">>>;
  /** `models.prices`, keyed by `<provider>/<model>`. */
  readonly prices: Readonly<Record<string, RuntimeModelPrice>>;
}

/**
 * The price of a model named `<provider>/<model>` (runtime spec, section 8.3): the config's
 * `models.prices` first, then the built-in table for its provider's kind. `undefined` when
 * neither has one, or the provider is not configured.
 */
export function modelPriceOf(
  name: string,
  book: PriceBook,
): { readonly price: ModelPrice; readonly source: PriceSource } | undefined {
  const configured = book.prices[name];
  if (configured !== undefined) {
    return { price: configured, source: "config" };
  }
  const slash = name.indexOf("/");
  const provider = slash <= 0 ? undefined : book.providers[name.slice(0, slash)];
  const price =
    provider === undefined ? undefined : builtInPrice(provider.kind, name.slice(slash + 1));
  return price === undefined ? undefined : { price, source: "built_in" };
}

/**
 * Whether a model's spend is known: its provider reports each call's cost (the `binference`
 * gateway), or it has a price. `binference check` names a configured model for which this is
 * false, since its calls count $0 against the budget.
 */
export function isModelPriced(name: string, book: PriceBook): boolean {
  const slash = name.indexOf("/");
  const provider = slash <= 0 ? undefined : book.providers[name.slice(0, slash)];
  return provider?.kind === "binference" || modelPriceOf(name, book) !== undefined;
}
