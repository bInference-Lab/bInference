import type { ErrorCode } from "@binference/core";
import { noUploadImage } from "@binference/protocol";
import { type IntentReason, intentReasons } from "../intents/intent-reason.js";
import { isTerminalState } from "../intents/intent-state.js";
import type { EngineCaller } from "../operations/engine-call.js";
import { ownerChatScopes } from "../surfaces/create-owner-calls.js";
import { type DraftEnd, publishDraftClosed } from "./launch-draft-closed.js";
import type { LaunchDraftDeskOptions } from "./launch-draft-desk.js";
import type { LaunchDraft } from "./launch-draft-shelf.js";

/** The launches the owner's Start began, each proposed in the background within its own time. */
export interface DraftStarts {
  /** Proposes the taken draft's launch as the owner on Telegram, and tells how it went. */
  run(draft: LaunchDraft, ownerId: number): void;
  /** Resolves once every launch begun so far has been proposed or stopped. */
  idle(): Promise<void>;
  /** Stops every launch still being proposed, and waits for them. */
  close(): Promise<void>;
}

// A launch's quote, upload and first pin read fit well within this; past it, its proposal stops.
const defaultStartTimeoutMs = 120_000;

// The owner on Telegram, as the one proposal the owner's chat makes runs (decision 0285), with
// the outside-content mark of the agent's turn that drafted it, so its card warns as the turn's
// own proposals would.
function ownerOnTelegram(userId: number, draft: LaunchDraft): EngineCaller {
  return {
    credential: `tg:${String(userId)}`,
    client: { kind: "telegram" },
    scopes: ownerChatScopes,
    turn: { hasOutsideContent: draft.hasOutsideContent },
  };
}

// The draft's photo on the upload shelf, held by the owner's Telegram credential, or `none` for a
// launchpad that takes a link: the bytes the draft showed, never a new read (decision 0286).
function imageOf(options: LaunchDraftDeskOptions, draft: LaunchDraft, holder: string) {
  const { picture } = draft;
  if (picture === undefined) {
    return noUploadImage;
  }
  const plan = { contentType: picture.image.contentType, bytes: picture.image.bytes };
  const { ticket } = options.uploads.ticket(plan, holder);
  const received = options.uploads.receive(ticket, picture.bytes);
  return received.ok ? received.value : undefined;
}

// An ended intent's reason as the engine stores it; one with none ended as a check failed.
function reasonOf(stored: string | undefined): IntentReason {
  return intentReasons.find((reason) => reason === stored) ?? "launch_unread";
}

function failed(options: LaunchDraftDeskOptions, draft: LaunchDraft, error: ErrorCode): void {
  publishDraftClosed(options.publish, draft, { outcome: "failed", error });
}

// Proposes the draft's launch and tells how it went: started while the launch is on its way to its
// card, or failed, with the proposal's refusal or the reason its launch ended before its card.
async function proposeDraft(
  options: LaunchDraftDeskOptions,
  draft: LaunchDraft,
  call: { readonly ownerId: number; readonly signal: AbortSignal },
): Promise<void> {
  const caller = ownerOnTelegram(call.ownerId, draft);
  const image = imageOf(options, draft, caller.credential);
  if (image === undefined) {
    failed(options, draft, "image.unreadable");
    return;
  }
  const args = { ...draft.request, image };
  const proposed = await options.propose({ args, caller, signal: call.signal });
  if (!proposed.ok) {
    failed(options, draft, proposed.error);
    return;
  }
  // A launch the policy refused, or whose quote, upload or first pin read failed, ended before its
  // card: the draft says why, never that the launch started.
  const { intent, state } = proposed.value;
  const end: DraftEnd = isTerminalState(state)
    ? { outcome: "failed", intent, reason: reasonOf(proposed.value.outcome?.reason) }
    : { outcome: "started", intent };
  publishDraftClosed(options.publish, draft, end);
}

/**
 * Creates the {@link DraftStarts}: each launch is proposed on a signal of its own, which stops at
 * its time or at `close`, so a press never waits on a launchpad. A fault ends the draft as failed
 * with `internal.error`; the launch path itself tells the owner of a launch it cut short.
 */
export function createDraftStarts(options: LaunchDraftDeskOptions): DraftStarts {
  const timeoutMs = options.startTimeoutMs ?? defaultStartTimeoutMs;
  const stop = new AbortController();
  const running = new Set<Promise<void>>();
  return {
    run(draft, ownerId) {
      const signal = AbortSignal.any([stop.signal, AbortSignal.timeout(timeoutMs)]);
      const started: Promise<void> = proposeDraft(options, draft, { ownerId, signal })
        .catch(() => {
          failed(options, draft, "internal.error");
        })
        .finally(() => running.delete(started));
      running.add(started);
    },
    idle: async () => {
      await Promise.all(running);
    },
    close: async () => {
      stop.abort(new Error("The engine stopped."));
      await Promise.all(running);
    },
  };
}
