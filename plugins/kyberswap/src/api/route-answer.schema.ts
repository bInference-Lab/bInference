import type { Address } from "viem";
import { z } from "zod";
import { addressSchema, baseUnitsSchema } from "./answer-fields.schema.js";
import { parseJsonText } from "./json-text.schema.js";

/** One pool a route passes through, as KyberSwap's answer names it. */
export interface RouteHop {
  /** KyberSwap's DEX id, such as `pancake-infinity-cl-fairflow`. */
  readonly exchange: string;
  /** KyberSwap's pool type, such as `pancake-infinity-cl`. */
  readonly poolType: string;
  /**
   * The pool's hook, when the answer names one. An empty string is a hook field the answer holds
   * in a form no address takes.
   */
  readonly hookAddress?: string;
}

/** A route KyberSwap found for a trade, read from its routes answer. */
export interface FoundRoute {
  /** The router the route's build calls. */
  readonly routerAddress: Address;
  readonly tokenIn: Address;
  readonly tokenOut: Address;
  readonly amountIn: bigint;
  /** What the route pays out, net of any transfer tax KyberSwap knows of, in base units. */
  readonly amountOut: bigint;
  /** KyberSwap's estimates of the input and output in USD, as decimal text. */
  readonly amountInUsd: string;
  readonly amountOutUsd: string;
  /** Whether the route takes a fee beyond its pools' own. */
  readonly chargesFee: boolean;
  /** Every pool of every path, and every candidate pool the answer nests beside them. */
  readonly hops: readonly RouteHop[];
  /** The route summary as JSON text, which the build sends back unchanged. */
  readonly summary: string;
}

const hopSchema = z.looseObject({
  exchange: z.string(),
  poolType: z.string(),
  poolExtra: z.unknown().optional(),
});
const summarySchema = z.looseObject({
  tokenIn: addressSchema,
  tokenOut: addressSchema,
  amountIn: baseUnitsSchema,
  amountOut: baseUnitsSchema,
  amountInUsd: z.string(),
  amountOutUsd: z.string(),
  extraFee: z.looseObject({ feeAmount: z.string() }).optional(),
  route: z.array(z.array(hopSchema).min(1)).min(1),
});
const answerSchema = z.looseObject({
  code: z.literal(0),
  data: z.looseObject({ routeSummary: z.unknown(), routerAddress: addressSchema }),
});
const hookFieldSchema = z.looseObject({ hookAddress: z.unknown() });
const nestingSchema = z.union([z.array(z.unknown()), z.record(z.string(), z.unknown())]);

// KyberSwap nests candidate pools a few levels deep; an answer nested deeper is not read.
const maxDepth = 32;

function hookOf(poolExtra: unknown): string | undefined {
  const field = hookFieldSchema.safeParse(poolExtra);
  if (!field.success || !("hookAddress" in field.data)) {
    return undefined;
  }
  const hook = field.data.hookAddress;
  return typeof hook === "string" ? hook : "";
}

function hopOf(value: unknown): RouteHop | undefined {
  const hop = hopSchema.safeParse(value);
  if (!hop.success) {
    return undefined;
  }
  const { exchange, poolType, poolExtra } = hop.data;
  const hookAddress = hookOf(poolExtra);
  return hookAddress === undefined ? { exchange, poolType } : { exchange, poolType, hookAddress };
}

// Every object shaped as a pool, at any depth: the paths' pools and the candidates nested in them.
function hopsWithin(value: unknown, depth: number): readonly RouteHop[] | undefined {
  const nested = nestingSchema.safeParse(value);
  if (!nested.success) {
    return [];
  }
  if (depth > maxDepth) {
    return undefined;
  }
  const children = Array.isArray(nested.data) ? nested.data : Object.values(nested.data);
  const found = children.map((child) => hopsWithin(child, depth + 1));
  if (found.some((hops) => hops === undefined)) {
    return undefined;
  }
  const own = hopOf(value);
  return [...(own === undefined ? [] : [own]), ...found.flatMap((hops) => hops ?? [])];
}

/**
 * Reads a routes answer of KyberSwap's API into the route it found. An answer that is not a found
 * route, or that nests deeper than any route KyberSwap gives, is undefined.
 */
export function readRouteAnswer(body: string): FoundRoute | undefined {
  const answer = answerSchema.safeParse(parseJsonText(body));
  const summary = answer.success
    ? summarySchema.safeParse(answer.data.data.routeSummary)
    : undefined;
  if (!answer.success || summary?.success !== true) {
    return undefined;
  }
  const hops = hopsWithin(summary.data.route, 0);
  if (hops === undefined) {
    return undefined;
  }
  const { tokenIn, tokenOut, amountIn, amountOut, amountInUsd, amountOutUsd } = summary.data;
  return {
    routerAddress: answer.data.data.routerAddress,
    tokenIn,
    tokenOut,
    amountIn,
    amountOut,
    amountInUsd,
    amountOutUsd,
    chargesFee: (summary.data.extraFee?.feeAmount ?? "") !== "",
    hops,
    summary: JSON.stringify(answer.data.data.routeSummary),
  };
}
