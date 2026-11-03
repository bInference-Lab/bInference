import { accountRefParts, type AssetRef, assetRefSchema, type ChainRef } from "@binference/chain";
import type { ProtocolClient } from "@binference/client";
import { type Bps, bpsSchema } from "@binference/core";
import { displayOutsideText } from "@binference/i18n";
import type { FillSize, ProtocolId, WebhookRuleRequest } from "@binference/protocol";
import { selfHostedChains } from "../compose/open-engine-parts.js";
import { usdSchema } from "../config/schema/value-formats.schema.js";
import { baseUnitsOf } from "../init/base-units.js";
import type { CliOutput, ExitCode, StepOutcome } from "../program/cli-output.js";
import type { CommandRun } from "../program/command-run.js";
import type { WebhookCreateFlags } from "../program/webhook-flags.schema.js";
import { withAgent } from "./agent-choice.js";
import { runCardAnswer } from "./card-answer-command.js";

/** A token the owner named, as `asset/search` found it: its id, and its decimals when known. */
interface FoundAsset {
  readonly asset: AssetRef;
  readonly decimals?: number;
}

/** What `webhookRule/create` answered, and the intent of the rule's card. */
interface CreatedRule {
  readonly rule: ProtocolId<"webhookRule">;
  readonly intent: ProtocolId<"intent">;
}

// A symbol is set by whoever deployed the token, so it is cut and made visible.
const symbolLength = 16;

// A share or a slippage typed in percent, such as `25` or `0.5`, in basis points.
function bpsOf(text: string): Bps | undefined {
  const base = baseUnitsOf(text, 2);
  const parsed = base === undefined ? undefined : bpsSchema.safeParse(Number(base));
  return parsed?.success === true ? parsed.data : undefined;
}

function usdOf(text: string): bigint | undefined {
  const parsed = usdSchema.safeParse(text);
  return parsed.success ? parsed.data : undefined;
}

function badValue(output: CliOutput, flag: string, value: string): StepOutcome<never> {
  output.fail({ code: "cli.bad_value", key: "webhook.badValue", values: { flag, value } });
  return { ok: false, code: 1 };
}

// The token a query names on the chain: the one the registry or an address names, else why not.
async function foundAsset(
  context: {
    readonly run: CommandRun;
    readonly client: ProtocolClient;
    readonly signal: AbortSignal;
  },
  search: { readonly chain: ChainRef; readonly agent: ProtocolId<"agent">; readonly query: string },
): Promise<StepOutcome<FoundAsset>> {
  const { run, client, signal } = context;
  const found = await client.call("asset/search", search, { signal });
  const [only] = found.items;
  const [unlisted] = found.unlisted ?? [];
  if (found.items.length === 1 && only !== undefined) {
    return { ok: true, value: { asset: only.asset, decimals: only.decimals } };
  }
  if (found.items.length === 0 && unlisted !== undefined) {
    return { ok: true, value: { asset: unlisted.asset } };
  }
  const matches = found.items.map(({ symbol }) => displayOutsideText(symbol, symbolLength));
  const values = { token: search.query, matches: matches.join(", ") };
  const key = matches.length > 1 ? "webhook.ambiguousToken" : "webhook.unknownToken";
  run.output.fail({ code: "cli.unknown_token", key, values });
  return { ok: false, code: 1 };
}

// Each fill's size from the one flag that gives it; an amount in the decimals of what it counts.
function sizeOf(
  output: CliOutput,
  options: WebhookCreateFlags,
  counted: FoundAsset,
): StepOutcome<FillSize> {
  const { usd, amount, percent } = options;
  if (usd !== undefined) {
    const usdMicros = usdOf(usd);
    return usdMicros === undefined
      ? badValue(output, "--usd", usd)
      : { ok: true, value: { usdMicros } };
  }
  if (percent !== undefined) {
    const percentBps = bpsOf(percent);
    return percentBps === undefined || percentBps === 0
      ? badValue(output, "--percent", percent)
      : { ok: true, value: { percentBps } };
  }
  if (amount === undefined) {
    output.fail({ code: "cli.no_size", key: "webhook.noSize" });
    return { ok: false, code: 1 };
  }
  if (counted.decimals === undefined) {
    output.fail({ code: "cli.unknown_decimals", key: "webhook.amountUnknown", values: { amount } });
    return { ok: false, code: 1 };
  }
  const base = baseUnitsOf(amount, counted.decimals);
  return base === undefined || base === 0n
    ? badValue(output, "--amount", amount)
    : { ok: true, value: { base } };
}

// The worst price and the most slippage, each as `webhookRule/create` takes it.
function pricingOf(
  output: CliOutput,
  options: WebhookCreateFlags,
): StepOutcome<Pick<WebhookRuleRequest, "worstPrice" | "maxSlippageBps">> {
  const { worstPrice, slippage } = options;
  const price = worstPrice === undefined ? undefined : usdOf(worstPrice);
  if (worstPrice !== undefined && (price === undefined || price === 0n)) {
    return badValue(output, "--worst-price", worstPrice);
  }
  const slippageBps = slippage === undefined ? undefined : bpsOf(slippage);
  if (slippage !== undefined && slippageBps === undefined) {
    return badValue(output, "--slippage", slippage);
  }
  return {
    ok: true,
    value: {
      ...(price === undefined ? {} : { worstPrice: price }),
      ...(slippageBps === undefined ? {} : { maxSlippageBps: slippageBps }),
    },
  };
}

// The counts and the expiry, as `webhookRule/create` takes them.
function countsOf(
  options: WebhookCreateFlags,
  nowMs: number,
): Pick<WebhookRuleRequest, "maxFills" | "ratePerMinute" | "expiresAt"> {
  const { maxFills, rate, ttlMs } = options;
  return {
    ...(maxFills === undefined ? {} : { maxFills }),
    ...(rate === undefined ? {} : { ratePerMinute: rate }),
    ...(ttlMs === undefined ? {} : { expiresAt: nowMs + ttlMs }),
  };
}

// What a buy spends when it names nothing: the chain's coin, with its decimals.
function coinOf(chain: ChainRef): FoundAsset | undefined {
  const registered = selfHostedChains().get(chain);
  if (!registered.ok) {
    return undefined;
  }
  const { assetNamespace, assetReference, decimals } = registered.value.definition.nativeAsset;
  return { asset: assetRefSchema.parse(`${chain}/${assetNamespace}:${assetReference}`), decimals };
}

interface RequestContext {
  readonly run: CommandRun;
  readonly client: ProtocolClient;
  readonly signal: AbortSignal;
  readonly agent: ProtocolId<"agent">;
}

/** The token a rule trades, what a buy names to spend, and what its `--amount` counts. */
interface RuleAssets {
  readonly token: FoundAsset;
  readonly spend?: FoundAsset;
  readonly counted: FoundAsset | undefined;
}

// The chain the rule trades on: the named wallet's, else the agent's first wallet's.
async function chainOf(
  context: RequestContext,
  options: WebhookCreateFlags,
): Promise<StepOutcome<ChainRef>> {
  const { client, agent, signal } = context;
  const wallets = await client.call("wallet/list", { agent }, { signal });
  const wallet = wallets.items.find(
    (each) => options.wallet === undefined || each.wallet === options.wallet,
  );
  if (wallet === undefined) {
    context.run.output.refuse("wallet.not_found");
    return { ok: false, code: 1 };
  }
  return { ok: true, value: accountRefParts(wallet.address).chain };
}

// The rule's token and what a buy spends, found on its wallet's chain.
async function assetsOf(
  context: RequestContext,
  options: WebhookCreateFlags,
): Promise<StepOutcome<RuleAssets>> {
  const { agent } = context;
  const onChain = await chainOf(context, options);
  if (!onChain.ok) {
    return onChain;
  }
  const chain = onChain.value;
  const token = await foundAsset(context, { chain, agent, query: options.token });
  if (!token.ok) {
    return token;
  }
  if (options.side === "sell") {
    return { ok: true, value: { token: token.value, counted: token.value } };
  }
  if (options.spend === undefined) {
    return { ok: true, value: { token: token.value, counted: coinOf(chain) } };
  }
  const spend = await foundAsset(context, { chain, agent, query: options.spend });
  return spend.ok
    ? { ok: true, value: { token: token.value, spend: spend.value, counted: spend.value } }
    : spend;
}

async function requestOf(
  context: RequestContext,
  options: WebhookCreateFlags,
): Promise<StepOutcome<WebhookRuleRequest>> {
  const { run, agent } = context;
  const assets = await assetsOf(context, options);
  if (!assets.ok) {
    return assets;
  }
  const { token, spend, counted } = assets.value;
  const size = sizeOf(run.output, options, counted ?? { asset: token.asset });
  const pricing = pricingOf(run.output, options);
  if (!size.ok) {
    return size;
  }
  if (!pricing.ok) {
    return pricing;
  }
  return {
    ok: true,
    value: {
      agent,
      ...(options.wallet === undefined ? {} : { wallet: options.wallet }),
      name: options.name,
      token: token.asset,
      side: options.side,
      size: size.value,
      ...(spend === undefined ? {} : { spend: spend.asset }),
      ...pricing.value,
      ...countsOf(options, run.host.clock.now()),
    },
  };
}

// Creates the rule and shows its URL this once; the intent of its card for the answer after.
async function createdRule(
  run: CommandRun,
  options: WebhookCreateFlags,
): Promise<StepOutcome<CreatedRule>> {
  const held: { created?: CreatedRule } = {};
  const code = await withAgent(run, options.agent, async (client, agent, signal) => {
    const request = await requestOf({ run, client, signal, agent }, options);
    if (!request.ok) {
      return request.code;
    }
    const { rule, url } = await client.call("webhookRule/create", request.value, { signal });
    const { items } = await client.call("webhookRule/list", {}, { signal });
    const intent = items.find((listed) => listed.rule === rule)?.intent;
    run.output.json({ rule, url, ...(intent === undefined ? {} : { intent }) });
    run.output.say("webhook.created", { rule, url });
    if (intent === undefined) {
      return 1;
    }
    held.created = { rule, intent };
    return 0;
  });
  return held.created === undefined ? { ok: false, code } : { ok: true, value: held.created };
}

/**
 * `binference webhook create --name <text> --token <token> --side <buy|sell>` with one of `--usd`,
 * `--amount` or `--percent`: stores an alert rule awaiting its card through `webhookRule/create`
 * (decisions 0299 and 0337), with the token and what a buy spends found by `asset/search` on the
 * chain of the agent's wallet. It prints the rule's URL this once: binference keeps it nowhere, and
 * the same call again is refused, so the owner rotates the rule for a new one. It then shows the
 * rule's card and asks to confirm it as `binference confirm` does; with `--yes` it confirms
 * without the question, and with `--json` alone it leaves the card open for `binference confirm`.
 * With `--json` it prints `{ rule, url, intent }`.
 */
export async function runWebhookCreate(
  run: CommandRun,
  options: WebhookCreateFlags,
): Promise<ExitCode> {
  const created = await createdRule(run, options);
  if (!created.ok) {
    return created.code;
  }
  const { intent } = created.value;
  if (!options.yes && (run.host.prompter === undefined || options.json)) {
    run.output.say("webhook.confirmLater", { intent });
    return 0;
  }
  return runCardAnswer(run, { name: "confirm", options, intent });
}
