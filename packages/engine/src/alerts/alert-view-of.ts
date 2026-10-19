import type { AlertView } from "@binference/protocol";
import type { AlertRecord } from "./alert-record.js";

/** A stored alert as `alert/create`, `alert/list` and its wake-ups show it. */
export function alertViewOf(alert: AlertRecord): AlertView {
  const { id, agentId, condition, state, wake, fires, createdAtMs, firedAtMs, expiresAtMs } = alert;
  return {
    alert: id,
    agent: agentId,
    condition,
    state,
    wake,
    fires,
    createdAt: createdAtMs,
    ...(firedAtMs === undefined ? {} : { firedAt: firedAtMs }),
    ...(expiresAtMs === undefined ? {} : { expiresAt: expiresAtMs }),
  };
}
