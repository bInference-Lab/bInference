import { type ProtocolId, protocolIdSchema } from "@binference/protocol";
import { z } from "zod";
import type { AgentFlags, CommonOptions } from "./cli-flags.schema.js";

/**
 * What `webhook create` takes: the rule's name, the token each alert trades and how, its size by
 * one of `--usd`, `--amount` or `--percent`, and its other bounds, each as typed.
 */
export interface WebhookCreateFlags extends AgentFlags {
  readonly wallet?: ProtocolId<"wallet">;
  readonly name: string;
  /** A symbol the registry lists, or an address. */
  readonly token: string;
  readonly side: "buy" | "sell";
  /** Each fill's dollars, such as `20`. */
  readonly usd?: string;
  /** Each fill's amount of what a buy spends or a sale sells, such as `0.5`. */
  readonly amount?: string;
  /** Each fill's share of that balance, in percent, such as `25`. */
  readonly percent?: string;
  /** What a buy spends, a symbol or an address; the chain's coin when left out. */
  readonly spend?: string;
  /** Dollars per whole token. */
  readonly worstPrice?: string;
  /** In percent, such as `0.5`. */
  readonly slippage?: string;
  readonly maxFills?: number;
  readonly rate?: number;
  /** How long the rule lasts, in milliseconds; 30 days when left out. */
  readonly ttlMs?: number;
}

/** What `webhook events` takes: older alerts than the row `--before` names, when it is set. */
export interface WebhookEventsFlags extends CommonOptions {
  readonly before?: number;
}

const text = z.string().min(1).max(128);
const common = { json: z.boolean().default(false), yes: z.boolean().default(false) };

/** Parses the options commander read for `webhook create`. */
export const webhookCreateFlagsSchema: z.ZodType<WebhookCreateFlags> = z
  .object({
    ...common,
    agent: protocolIdSchema("agent").exactOptional(),
    wallet: protocolIdSchema("wallet").exactOptional(),
    name: z.string().min(1).max(64),
    token: text,
    side: z.enum(["buy", "sell"]),
    usd: text.exactOptional(),
    amount: text.exactOptional(),
    percent: text.exactOptional(),
    spend: text.exactOptional(),
    worstPrice: text.exactOptional(),
    slippage: text.exactOptional(),
    maxFills: z.int().min(1).exactOptional(),
    rate: z.int().min(1).max(60).exactOptional(),
    ttl: z.int().positive().exactOptional(),
  })
  .transform(({ ttl, ...flags }) => (ttl === undefined ? flags : { ...flags, ttlMs: ttl }));

/** Parses the options commander read for `webhook events`. */
export const webhookEventsFlagsSchema: z.ZodType<WebhookEventsFlags> = z.object({
  ...common,
  before: z.int().positive().exactOptional(),
});
