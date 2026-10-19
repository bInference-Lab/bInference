import type { ChainRegistry } from "@binference/chain";
import { type Clock, jsonValueSchema } from "@binference/core";
import {
  type AlertFire,
  type AlertFired,
  alertFiredSchema,
  type AssetInfos,
} from "@binference/protocol";
import type { AgentSettings } from "../agents/agent-record.js";
import type { PublishPush } from "../pushes/engine-push.js";
import { noticePush } from "../pushes/notice-push.js";
import type { AlertFireWritten } from "./alert-fire.js";
import { alertNotice } from "./alert-notices.js";
import type { AlertRecord } from "./alert-record.js";
import type { AlertStore } from "./ports.js";

/** Where a fire is told: the registry its words read, and the pushes. */
export interface TellParts {
  readonly chains: ChainRegistry;
  readonly publish: PublishPush;
}

// The most alerts one call tells the held matches of; the rest wait for the next call.
const heldPerCall = 100;

// The line that tells an alert's matches its notice hour held back (owner's choice, decision 0245).
function heldNotice(alert: AlertRecord, held: number) {
  return noticePush({
    key: "notice.alertHeld",
    agent: alert.agentId,
    values: { count: String(held) },
  });
}

/**
 * Tells one fire: `alert/fired` always, then its notice while its alert's notice hour allows,
 * after the line that tells the matches the previous hour held back.
 */
export function tellFire(
  parts: TellParts,
  fire: {
    readonly alert: AlertRecord;
    readonly fired: AlertFire;
    readonly written: AlertFireWritten;
    readonly settings: AgentSettings | undefined;
    readonly assets: AssetInfos;
    readonly atMs: number;
  },
): AlertFired {
  const { alert, fired, written, settings, assets, atMs } = fire;
  const { woke, wakeSkipped, notify, heldBefore } = written;
  const skipped = wakeSkipped === undefined ? {} : { wakeSkipped };
  const data: AlertFired = {
    alert: alert.id,
    agent: alert.agentId,
    at: atMs,
    fired,
    woke,
    ...skipped,
    assets,
  };
  const encoded = jsonValueSchema.parse(alertFiredSchema.encode(data));
  parts.publish({ topic: "alert", kind: "alert/fired", data: encoded });
  if (heldBefore !== undefined) {
    parts.publish(heldNotice(alert, heldBefore));
  }
  if (notify) {
    const agentName = settings?.agent.name ?? alert.agentId;
    const addressBook = settings?.addressBook ?? [];
    const context = { chains: parts.chains, addressBook, assets, nowMs: atMs };
    parts.publish(noticePush(alertNotice({ alert, fired, agentName, woke, ...skipped }, context)));
  }
  return data;
}

/**
 * Tells, once, each alert's matches that a notice hour that has ended held back, in one line per
 * alert, and answers how many alerts it told. The orders' tick calls it.
 */
export async function tellHeld(
  parts: TellParts & { readonly alerts: Pick<AlertStore, "heldNotices">; readonly clock: Clock },
  signal: AbortSignal,
): Promise<number> {
  const query = { atMs: parts.clock.now(), limit: heldPerCall };
  const held = await parts.alerts.heldNotices(query, { signal });
  held.forEach(({ alert, held: count }) => {
    parts.publish(heldNotice(alert, count));
  });
  return held.length;
}

/** Whether an agent is gone or archived: its alerts end, and none is told. */
export function isRetired(settings: AgentSettings | undefined): boolean {
  return settings === undefined || settings.agent.archivedAtMs !== undefined;
}
