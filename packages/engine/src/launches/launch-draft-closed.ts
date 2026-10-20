import type { ErrorCode, Id } from "@binference/core";
import type { LaunchDraftPush } from "@binference/protocol";
import { chatTopic } from "../chat/chat-relay-parts.js";
import type { IntentReason } from "../intents/intent-reason.js";
import type { PublishPush } from "../pushes/engine-push.js";
import type { LaunchDraft } from "./launch-draft-shelf.js";

/** How a launch draft ended, as `chat/launchDraftClosed` carries it. */
export type DraftEnd =
  | {
      readonly outcome: Exclude<
        Extract<LaunchDraftPush, { readonly kind: "chat/launchDraftClosed" }>["outcome"],
        "started" | "failed"
      >;
    }
  | { readonly outcome: "started"; readonly intent: Id<"int"> }
  | { readonly outcome: "failed"; readonly error: ErrorCode }
  | { readonly outcome: "failed"; readonly intent: Id<"int">; readonly reason: IntentReason };

/** Tells every surface of the agent's chat how its launch draft ended (decision 0285). */
export function publishDraftClosed(publish: PublishPush, draft: LaunchDraft, end: DraftEnd): void {
  publish({
    topic: chatTopic(draft.agentId),
    kind: "chat/launchDraftClosed",
    data: { agent: draft.agentId, draft: draft.id, ...end },
  });
}
