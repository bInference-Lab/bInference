import type { EnginePush } from "./engine-push.js";
import { noticePush } from "./notice-push.js";

/** The message key of the notice that the engine started locked (spec 4, section 4). */
export const lockedNoticeKey = "notice.locked";

/**
 * The notice that tells every surface the engine started without the agent key: it answers reads
 * and fills paper intents, but signs nothing until the owner runs `binference unlock` (spec 5,
 * section 3). It names no agent, since the lock holds for the whole install.
 */
export function lockedNotice(): EnginePush {
  return noticePush({ key: lockedNoticeKey, values: {} });
}

/** The message key of the notice that the signer stopped while the engine ran (decision 0117). */
export const signerStoppedNoticeKey = "notice.signerStopped";

/**
 * The notice that tells every surface the signer stopped after start, so the engine locked again
 * and signs nothing until the owner fixes the cause and runs `binference unlock`. It names no
 * agent, since the lock holds for the whole install.
 */
export function signerStoppedNotice(): EnginePush {
  return noticePush({ key: signerStoppedNoticeKey, values: {} });
}
