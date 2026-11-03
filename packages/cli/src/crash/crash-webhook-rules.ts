import { setTimeout as wait } from "node:timers/promises";
import { BinferenceError, type Id, idSchema } from "@binference/core";
import { intentStates } from "@binference/engine";
import { protocolIdSchema } from "@binference/protocol";
import { connectClient } from "../e2e/test-host.js";
import { createSystemHttp } from "../runtime/system-http.js";
import { crashUsdtAsset } from "./crash-orders.js";
import { withStore } from "./crash-reads.js";
import { type CrashInstall, goneLive } from "./crash-runs.js";

const call = (): { readonly signal: AbortSignal } => ({ signal: AbortSignal.timeout(30_000) });
const http = createSystemHttp({ version: "crash" });

/** A run's rule: its id and its URL. */
export interface CrashRule {
  readonly rule: Id<"whr">;
  readonly url: string;
}

/**
 * The owner makes a rule that buys 0.001 BNB of USDT on each alert and confirms its card, as
 * from the CLI: on paper, after resetting the paper portfolio, or live, after the agent went live.
 */
export async function crashRuleOf(
  install: CrashInstall,
  mode: { readonly isLive: boolean },
): Promise<CrashRule> {
  const client = await connectClient(install.machine);
  try {
    const [found] = (await client.call("engine/status", {}, call())).agents;
    if (found === undefined) {
      throw new BinferenceError({ code: "crash.no_agent", message: "init made no agent." });
    }
    const agent = mode.isLive ? await goneLive(client, call()) : found;
    if (!mode.isLive) {
      await client.call("portfolio/resetPaper", { agent: agent.id }, call());
    }
    const request = {
      agent: agent.id,
      name: "USDT on each alert",
      token: crashUsdtAsset,
      side: "buy",
      size: { base: 10n ** 15n },
      ratePerMinute: 5,
    } as const;
    const created = await client.call("webhookRule/create", request, call());
    const rule = idSchema("whr").parse(created.rule);
    const stored = await withStore(install.machine.folder, async (stores, signal) =>
      stores.webhookRules.get(rule, { signal }),
    );
    const intent = protocolIdSchema("intent").parse(stored?.intentId);
    const card = await client.call("intent/card", { intent }, call());
    await client.call(
      "intent/confirm",
      { intent, card: card.card, cardVersion: card.version },
      call(),
    );
    return { rule, url: created.url };
  } finally {
    client.close();
  }
}

/** Posts one alert to the rule's URL, at the engine's own webhook port; answers its status. */
export async function postCrashAlert(install: CrashInstall, rule: CrashRule): Promise<number> {
  const { pathname } = new URL(rule.url);
  const url = `http://127.0.0.1:${String(install.webhookPort)}${pathname}`;
  const answer = await http.request({
    method: "POST",
    url,
    body: "USDT up",
    signal: AbortSignal.timeout(10_000),
  });
  return answer.status;
}

/** What the store holds of the rule's alert, its fill intents and the rule. */
export interface AlertBooked {
  /** Each fill intent and its state: the intents of kind `buy`, which only the rule makes. */
  readonly fills: readonly { readonly intent: string; readonly state: string }[];
  /** The alert row's outcome and reason; none while it waits. */
  readonly alert: { readonly outcome?: string; readonly reason?: string; readonly intent?: string };
  readonly ruleFills: number;
}

/** Reads what the install's store holds of the rule's one alert and its fills. */
export async function alertBookedOf(install: CrashInstall, rule: CrashRule): Promise<AlertBooked> {
  return withStore(install.machine.folder, async (stores, signal) => {
    const intents = await stores.intents.list({ states: [...intentStates], limit: 20 }, { signal });
    const [row] = await stores.webhookRules.alerts({ ruleId: rule.rule, limit: 5 }, { signal });
    const record = await stores.webhookRules.get(rule.rule, { signal });
    return {
      fills: intents
        .filter(({ kind }) => kind === "buy")
        .map(({ id, state }) => ({ intent: id, state })),
      alert: {
        ...(row?.outcome === undefined ? {} : { outcome: row.outcome }),
        ...(row?.reason === undefined ? {} : { reason: row.reason }),
        ...(row?.intentId === undefined ? {} : { intent: row.intentId }),
      },
      ruleFills: record?.fills ?? -1,
    };
  });
}

/** Waits on the restarted engine until the alert ended, then stops it through `engine/stop`. */
export async function alertEndedAndStopped(install: CrashInstall, rule: CrashRule): Promise<void> {
  const deadline = Date.now() + 120_000;
  const poll = async (): Promise<void> => {
    const { alert } = await alertBookedOf(install, rule);
    if (alert.outcome !== undefined || Date.now() > deadline) {
      return;
    }
    await wait(200);
    return poll();
  };
  await poll();
  const client = await connectClient(install.machine);
  try {
    await client.call("engine/stop", {}, { signal: AbortSignal.timeout(10_000) }).catch(() => ({}));
  } finally {
    client.close();
  }
}
