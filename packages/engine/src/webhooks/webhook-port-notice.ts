import type { EnginePush } from "../pushes/engine-push.js";
import { noticePush } from "../pushes/notice-push.js";

/** The message key of the notice that the webhook listener's port was taken (decision 0333). */
export const webhookPortTakenNoticeKey = "notice.webhookPortTaken";

/**
 * The notice that tells every surface the engine runs without its webhook listener, since another
 * program, or the engine's own port, holds `port`: no alert rule takes an alert until the owner
 * sets `engine.webhookPort` to a free port and restarts. It names no agent, since the listener
 * serves the whole install.
 */
export function webhookPortTakenNotice(port: number): EnginePush {
  return noticePush({ key: webhookPortTakenNoticeKey, values: { port: String(port) } });
}
