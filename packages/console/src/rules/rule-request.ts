import { baseUnitsOf } from "@binference/i18n";
import { type ArgsOf, operations, type ProtocolId } from "@binference/protocol";

/** How the owner sizes each fill: in dollars, as an amount, or as a percent of the balance. */
export type SizeUnit = "usd" | "amount" | "percent";

/** A new rule's fields as the owner typed them in the console's form. */
export interface RuleFields {
  readonly name: string;
  readonly side: "buy" | "sell";
  readonly sizeUnit: SizeUnit;
  readonly size: string;
  readonly worstPrice: string;
  readonly slippage: string;
  readonly maxFills: string;
  readonly rate: string;
  /** Whole days the rule lasts; 30 when left empty. */
  readonly days: string;
}

/** A token the owner named, as `asset/search` found it, with its decimals when known. */
export interface FoundAsset {
  readonly asset: string;
  readonly decimals?: number;
}

/** What the form found for the rule: the token, what a buy spends, and what an amount counts. */
export interface FoundAssets {
  readonly token: FoundAsset;
  readonly spend?: FoundAsset;
  /** The asset an amount counts: the token for a sale, else what a buy spends, if known. */
  readonly counted?: FoundAsset;
}

/** The field a request cannot be made from, which the form names. */
export type RuleProblem =
  | "name"
  | "size"
  | "sizeUnknown"
  | "worstPrice"
  | "slippage"
  | "maxFills"
  | "rate"
  | "days";

/** The request, or the first field that stops it. */
export type RuleRequestOutcome =
  | { readonly ok: true; readonly request: ArgsOf<"webhookRule/create"> }
  | { readonly ok: false; readonly problem: RuleProblem };

const dayMs = 86_400_000;
// Dollars and percents read as micro-dollars and basis points: 6 and 2 decimals.
const usdDecimals = 6;
const percentDecimals = 2;
const whole = /^[1-9]\d{0,5}$/;

// Each fill's size on the wire, or the reason it cannot be read.
function sizeOf(
  fields: RuleFields,
  counted: FoundAsset | undefined,
): Readonly<Record<string, string | number>> | RuleProblem {
  const text = fields.size.trim();
  if (fields.sizeUnit === "amount" && counted?.decimals === undefined) {
    return "sizeUnknown";
  }
  const decimals = {
    usd: usdDecimals,
    percent: percentDecimals,
    amount: counted?.decimals ?? 0,
  }[fields.sizeUnit];
  const base = baseUnitsOf(text, decimals);
  if (base === undefined || base === 0n) {
    return "size";
  }
  const keys = { usd: "usdMicros", percent: "percentBps", amount: "base" } as const;
  return fields.sizeUnit === "percent"
    ? { [keys.percent]: Number(base) }
    : { [keys[fields.sizeUnit]]: base.toString() };
}

// An optional field typed as decimal text, in base units of `decimals`, or `undefined` when empty.
function optionalUnits(text: string, decimals: number): bigint | undefined | "bad" {
  const trimmed = text.trim();
  if (trimmed === "") {
    return undefined;
  }
  return baseUnitsOf(trimmed, decimals) ?? "bad";
}

function optionalWhole(text: string): number | undefined | "bad" {
  const trimmed = text.trim();
  if (trimmed === "") {
    return undefined;
  }
  return whole.test(trimmed) ? Number(trimmed) : "bad";
}

// The bounds besides the size on the wire, or the first that cannot be read.
function boundsOf(
  fields: RuleFields,
  nowMs: number,
): Readonly<Record<string, string | number>> | RuleProblem {
  const price = optionalUnits(fields.worstPrice, usdDecimals);
  const slippage = optionalUnits(fields.slippage, percentDecimals);
  const counts = {
    maxFills: optionalWhole(fields.maxFills),
    rate: optionalWhole(fields.rate),
    days: optionalWhole(fields.days),
  };
  const bad = (
    [
      ["worstPrice", price === 0n ? "bad" : price],
      ["slippage", slippage],
      ["maxFills", counts.maxFills],
      ["rate", counts.rate],
      ["days", counts.days],
    ] as const
  ).find(([, value]) => value === "bad");
  if (bad !== undefined) {
    return bad[0];
  }
  return {
    ...(typeof price === "bigint" ? { worstPrice: price.toString() } : {}),
    ...(typeof slippage === "bigint" ? { maxSlippageBps: Number(slippage) } : {}),
    ...(typeof counts.maxFills === "number" ? { maxFills: counts.maxFills } : {}),
    ...(typeof counts.rate === "number" ? { ratePerMinute: counts.rate } : {}),
    ...(typeof counts.days === "number" ? { expiresAt: nowMs + counts.days * dayMs } : {}),
  };
}

/** Whom a rule is for, what the form found for it, and when it is made. */
export interface RuleContext {
  readonly agent: ProtocolId<"agent">;
  readonly found: FoundAssets;
  readonly nowMs: number;
}

// A field the operation's schema refused, by the form field it came from; the name else.
const schemaProblems: Readonly<Record<string, RuleProblem>> = {
  ratePerMinute: "rate",
  maxSlippageBps: "slippage",
  maxFills: "maxFills",
  expiresAt: "days",
};

/**
 * The `webhookRule/create` request the form's fields make for the agent, with the assets the form
 * found, checked by the operation's own schema; or the first field it cannot be made from.
 */
export function ruleRequestOf(fields: RuleFields, context: RuleContext): RuleRequestOutcome {
  const { agent, found, nowMs } = context;
  const size = sizeOf(fields, found.counted);
  const bounds = boundsOf(fields, nowMs);
  if (typeof size === "string") {
    return { ok: false, problem: size };
  }
  if (typeof bounds === "string") {
    return { ok: false, problem: bounds };
  }
  const parsed = operations["webhookRule/create"].args.safeParse({
    agent,
    name: fields.name.trim(),
    token: found.token.asset,
    side: fields.side,
    size,
    ...(found.spend === undefined ? {} : { spend: found.spend.asset }),
    ...bounds,
  });
  if (parsed.success) {
    return { ok: true, request: parsed.data };
  }
  const field = String(parsed.error.issues[0]?.path[0] ?? "name");
  return { ok: false, problem: schemaProblems[field] ?? "name" };
}
