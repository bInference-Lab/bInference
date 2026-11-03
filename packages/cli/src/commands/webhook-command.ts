import { jsonValueSchema } from "@binference/core";
import { cardLineText, displayOutsideText, reasonText } from "@binference/i18n";
import {
  type AssetInfos,
  operations,
  type ProtocolId,
  type WebhookEventView,
  type WebhookRuleView,
} from "@binference/protocol";
import { z } from "zod";
import type { CommonOptions } from "../program/cli-flags.schema.js";
import type { ExitCode } from "../program/cli-output.js";
import type { CommandRun } from "../program/command-run.js";
import type { WebhookEventsFlags } from "../program/webhook-flags.schema.js";
import { withEngine } from "./connect-engine.js";

// A rule's name is the owner's text, shown as cards show it: cut and made visible.
const nameLength = 64;
// An alert's `id` is the sender's text, up to 128 characters, shown whole and made visible.
const alertIdLength = 128;

// What each alert of the rule trades, as its card words it, or its token's id when the engine
// could not draw it.
function summaryOf(run: CommandRun, rule: WebhookRuleView, assets: AssetInfos): string {
  return rule.summary === undefined
    ? rule.request.token
    : cardLineText(rule.summary, { formatter: run.formatter, assets });
}

function ruleValues(run: CommandRun, rule: WebhookRuleView, assets: AssetInfos) {
  const { request } = rule;
  return {
    rule: rule.rule,
    agent: rule.agent,
    name: displayOutsideText(request.name, nameLength),
    state: rule.state,
    summary: summaryOf(run, rule, assets),
    rate: rule.ratePerMinute ?? request.ratePerMinute ?? 1,
    fills: rule.fills,
    maxFills: request.maxFills ?? 0,
    expiry: request.expiresAt === undefined ? "" : run.formatter.dateTime(request.expiresAt),
    lastAlert: rule.lastAlertAt === undefined ? "" : run.formatter.dateTime(rule.lastAlertAt),
  };
}

/**
 * `binference webhook list`: every alert rule active or awaiting its card, oldest first, through
 * `webhookRule/list`: its name, what each alert trades as its card words it, its rate, its fills
 * and its expiry. A rule's URL is never shown again. With `--json` it prints the list as the
 * operation answers it.
 */
export async function runWebhookList(run: CommandRun): Promise<ExitCode> {
  const { host, output } = run;
  return withEngine(host, output, async (client, signal) => {
    const page = await client.call("webhookRule/list", {}, { signal });
    output.json(jsonValueSchema.parse(z.encode(operations["webhookRule/list"].result, page)));
    output.say("webhook.count", { count: page.items.length });
    const assets = page.assets ?? {};
    for (const rule of page.items) {
      output.item("webhook.item", ruleValues(run, rule, assets));
    }
    return 0;
  });
}

const yesOrNo = (value: string | undefined): "yes" | "no" => (value === undefined ? "no" : "yes");

// A skip's reason in words when they name nothing the list lacks, as `reasonText` gives them.
function eventValues(run: CommandRun, event: WebhookEventView) {
  const { alertId, intent } = event;
  const reason = event.reason === undefined ? undefined : reasonText(run.formatter, event.reason);
  return {
    event: event.event,
    at: run.formatter.dateTime(event.receivedAt),
    taken: event.taken,
    fill: event.fill ?? "waiting",
    hasReason: yesOrNo(reason),
    reason: reason ?? "",
    hasIntent: yesOrNo(intent),
    intent: intent ?? "",
    hasId: yesOrNo(alertId),
    alertId: alertId === undefined ? "" : displayOutsideText(alertId, alertIdLength),
  };
}

/**
 * `binference webhook events <rule> [--before <event>]`: what each alert to the rule's URL
 * became, the newest first, through `webhookRule/events`: filled, skipped and why, a repeat, or
 * over the rule's rate. It never shows an alert's body. With `--before` it starts below that row.
 * With `--json` it prints the page as the operation answers it.
 */
export async function runWebhookEvents(
  run: CommandRun,
  request: { readonly options: WebhookEventsFlags; readonly rule: ProtocolId<"webhookRule"> },
): Promise<ExitCode> {
  const { host, output } = run;
  const { rule, options } = request;
  return withEngine(host, output, async (client, signal) => {
    const cursor = options.before === undefined ? {} : { cursor: String(options.before) };
    const page = await client.call("webhookRule/events", { rule, ...cursor }, { signal });
    output.json(jsonValueSchema.parse(z.encode(operations["webhookRule/events"].result, page)));
    output.say("webhook.events", { rule, count: page.items.length });
    for (const event of page.items) {
      output.item("webhook.event", eventValues(run, event));
    }
    if (page.next !== undefined) {
      output.say("webhook.olderEvents", { rule, before: page.next });
    }
    return 0;
  });
}

/**
 * `binference webhook rotate <rule>`: gives the rule a new URL through `webhookRule/rotateUrl`,
 * which needs `admin`; the old one gets `404` at once, and alerts it took that still wait fill
 * nothing (decision 0337). The new URL is shown this once and kept nowhere. With `--json` it
 * prints `{ rule, url }`.
 */
export async function runWebhookRotate(
  run: CommandRun,
  request: { readonly options: CommonOptions; readonly rule: ProtocolId<"webhookRule"> },
): Promise<ExitCode> {
  const { host, output } = run;
  const { rule } = request;
  return withEngine(host, output, async (client, signal) => {
    const { url } = await client.call("webhookRule/rotateUrl", { rule }, { signal });
    output.json({ rule, url });
    output.say("webhook.rotated", { rule, url });
    return 0;
  });
}

/**
 * `binference webhook delete <rule>`: ends the rule through `webhookRule/delete`, a braking change
 * any surface with `confirm` may make; its URL gets `404` at once, and a card it waits on is
 * cancelled. With `--json` it prints `{ rule }`.
 */
export async function runWebhookDelete(
  run: CommandRun,
  request: { readonly options: CommonOptions; readonly rule: ProtocolId<"webhookRule"> },
): Promise<ExitCode> {
  const { host, output } = run;
  const { rule } = request;
  return withEngine(host, output, async (client, signal) => {
    await client.call("webhookRule/delete", { rule }, { signal });
    output.json({ rule });
    output.say("webhook.deleted", { rule });
    return 0;
  });
}
