import type { SignerRefusal, SignerServiceRefusal } from "@binference/chain";
import type { Id } from "@binference/core";
import type { EnginePush } from "../pushes/engine-push.js";
import { noticePush } from "../pushes/notice-push.js";

/** The message key of the notice that the signer refused a step (keys spec, section 5.2). */
export const signerRefusedNoticeKey = "notice.signerRefused";

/**
 * The notice that tells every surface the signer refused to sign a step of an intent, naming why
 * in plain words as the message's `rule` select: the request the signer process could not read,
 * the number of the hard rule it broke, or a signer service's reason of keys spec, section 8.3.
 * It names the intent, so a surface shows which trade.
 */
export function signerRefusedNotice(refused: {
  readonly intent: Id<"int">;
  readonly refused: SignerRefusal | SignerServiceRefusal;
}): EnginePush {
  return noticePush({
    key: signerRefusedNoticeKey,
    intent: refused.intent,
    values: { rule: refused.refused },
  });
}
