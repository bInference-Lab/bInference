import type { EnginePush } from "./engine-push.js";
import { noticePush } from "./notice-push.js";

/**
 * The notice that binference restarted itself and serves again (decision 0395):
 * `notice.restartedForConfig` naming the settings the restart applied, or `notice.restarted` when
 * the owner asked for it.
 */
export function restartedNotice(changed: readonly string[]): EnginePush {
  return changed.length === 0
    ? noticePush({ key: "notice.restarted", values: {} })
    : noticePush({ key: "notice.restartedForConfig", values: { changed: changed.join(", ") } });
}
