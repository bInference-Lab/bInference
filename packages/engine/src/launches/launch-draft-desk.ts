import type { ChainRegistry } from "@binference/chain";
import type { Clock, ErrorCode, Id } from "@binference/core";
import { type AssetInfos, noUploadImage } from "@binference/protocol";
import type { CardLine } from "../confirmations/card-line.js";
import type { EngineCaller, EngineHandler } from "../operations/engine-call.js";
import type { PublishPush } from "../pushes/engine-push.js";
import { ownerChatScopes } from "../surfaces/create-owner-calls.js";
import type { UploadShelf } from "../uploads/upload-shelf.js";
import type { LaunchHost } from "../venues/launch-host.js";
import { publishDraftClosed } from "./launch-draft-closed.js";
import { drawLaunchDraft } from "./launch-draft-lines.js";
import type { LaunchDraft, LaunchDraftShelf } from "./launch-draft-shelf.js";

/** A launch draft as a surface shows it: whose it is, its buttons' reference and its lines. */
export interface LaunchDraftShowing {
  readonly agent: Id<"agt">;
  readonly agentName: string;
  /** The reference its Start and Drop buttons carry. */
  readonly ref: string;
  readonly lines: readonly CardLine[];
  readonly assets: AssetInfos;
  readonly expiresAtMs: number;
}

/**
 * How a press of a launch draft's button stands. `started`: the launch was proposed, as its
 * intent. `dropped`: the owner dropped it. `expired`: its 10 minutes ran out before the press.
 * `failed`: the proposal was refused, with its code. `unknown`: no open draft has this reference;
 * nothing happened.
 */
export type LaunchDraftStanding =
  | { readonly status: "started"; readonly intent: Id<"int"> }
  | { readonly status: "dropped" }
  | { readonly status: "expired" }
  | { readonly status: "failed"; readonly error: ErrorCode }
  | { readonly status: "unknown" };

/** The engine's open launch drafts, as the owner's surfaces show them and the owner answers. */
export interface LaunchDraftDesk {
  /** The open draft with this id, as its message shows it; `undefined` once it ended. */
  showing(id: string): LaunchDraftShowing | undefined;
  /**
   * Starts the draft whose Start the owner pressed (decision 0285): it ends at once, so no other
   * press starts it, and its request is proposed as the owner on Telegram with the owner's photo
   * put on the upload shelf under the owner's Telegram credential (decision 0286). Call it only
   * for a press the owner's numeric Telegram id made.
   */
  start(
    ref: string,
    owner: { readonly userId: number },
    options: { readonly signal: AbortSignal },
  ): Promise<LaunchDraftStanding>;
  /** Drops the draft whose Drop the owner pressed. Call it only for the owner's press. */
  drop(ref: string): LaunchDraftStanding;
  /** Ends every draft whose time is up, and answers when the next one's is. */
  expire(): number | undefined;
}

/** What the desk keeps, draws, uploads and proposes through. */
export interface LaunchDraftDeskOptions {
  readonly shelf: LaunchDraftShelf;
  readonly host: Pick<LaunchHost, "picturePlace">;
  readonly chains: ChainRegistry;
  /** The owner's uploads, which the launch from a draft reads its picture from. */
  readonly uploads: Pick<UploadShelf, "ticket" | "receive">;
  readonly propose: EngineHandler<"intent/propose">;
  readonly clock: Clock;
  readonly publish: PublishPush;
}

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

// Proposes the draft's launch; a fault ends the draft's message as failed before it goes on, since
// the draft already ended.
async function proposeEnding(
  options: LaunchDraftDeskOptions,
  draft: LaunchDraft,
  call: Parameters<LaunchDraftDeskOptions["propose"]>[0],
): ReturnType<LaunchDraftDeskOptions["propose"]> {
  try {
    return await options.propose(call);
  } catch (fault) {
    publishDraftClosed(options.publish, draft, { outcome: "failed", error: "internal.error" });
    throw fault;
  }
}

async function startDraft(
  options: LaunchDraftDeskOptions,
  draft: LaunchDraft,
  call: { readonly userId: number; readonly signal: AbortSignal },
): Promise<LaunchDraftStanding> {
  const caller = ownerOnTelegram(call.userId, draft);
  const image = imageOf(options, draft, caller.credential);
  if (image === undefined) {
    publishDraftClosed(options.publish, draft, { outcome: "failed", error: "image.unreadable" });
    return { status: "failed", error: "image.unreadable" };
  }
  const args = { ...draft.request, image };
  const proposed = await proposeEnding(options, draft, { args, caller, signal: call.signal });
  if (!proposed.ok) {
    publishDraftClosed(options.publish, draft, { outcome: "failed", error: proposed.error });
    return { status: "failed", error: proposed.error };
  }
  const { intent } = proposed.value;
  publishDraftClosed(options.publish, draft, { outcome: "started", intent });
  return { status: "started", intent };
}

// Takes the draft a press names; one whose time is up ends as expired.
function pressed(options: LaunchDraftDeskOptions, ref: string): LaunchDraft | LaunchDraftStanding {
  const draft = options.shelf.take(ref);
  if (draft === undefined) {
    return { status: "unknown" };
  }
  if (draft.expiresAtMs > options.clock.now()) {
    return draft;
  }
  publishDraftClosed(options.publish, draft, { outcome: "expired" });
  return { status: "expired" };
}

const isStanding = (taken: LaunchDraft | LaunchDraftStanding): taken is LaunchDraftStanding =>
  "status" in taken;

/** Creates the {@link LaunchDraftDesk} over the engine's open drafts. */
export function createLaunchDraftDesk(options: LaunchDraftDeskOptions): LaunchDraftDesk {
  const { shelf, host, chains, clock, publish } = options;
  return {
    showing(id) {
      const draft = shelf.byId(id);
      if (draft === undefined) {
        return undefined;
      }
      const place = host.picturePlace(draft.request.venue);
      const { lines, assets } = drawLaunchDraft(draft, { chains, place });
      const { agentId: agent, agentName, ref, expiresAtMs } = draft;
      return { agent, agentName, ref, lines, assets, expiresAtMs };
    },
    async start(ref, owner, { signal }) {
      signal.throwIfAborted();
      const taken = pressed(options, ref);
      return isStanding(taken) ? taken : startDraft(options, taken, { ...owner, signal });
    },
    drop(ref) {
      const taken = pressed(options, ref);
      if (isStanding(taken)) {
        return taken;
      }
      publishDraftClosed(publish, taken, { outcome: "dropped" });
      return { status: "dropped" };
    },
    expire() {
      shelf.takeDue(clock.now()).forEach((draft) => {
        publishDraftClosed(publish, draft, { outcome: "expired" });
      });
      return shelf.nextDueMs();
    },
  };
}
