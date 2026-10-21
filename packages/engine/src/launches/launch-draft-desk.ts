import type { ChainRegistry } from "@binference/chain";
import type { Clock, Id } from "@binference/core";
import type { AssetInfos } from "@binference/protocol";
import type { CardLine } from "../confirmations/card-line.js";
import type { IntentReason } from "../intents/intent-reason.js";
import { isTerminalState } from "../intents/intent-state.js";
import type { EngineHandler } from "../operations/engine-call.js";
import type { IntentStore } from "../ports.js";
import type { PublishPush } from "../pushes/engine-push.js";
import type { OwnerStore } from "../surfaces/ports.js";
import type { UploadShelf } from "../uploads/upload-shelf.js";
import type { LaunchHost } from "../venues/launch-host.js";
import { publishDraftClosed } from "./launch-draft-closed.js";
import { drawLaunchDraft } from "./launch-draft-lines.js";
import type { LaunchDraft, LaunchDraftShelf } from "./launch-draft-shelf.js";
import { createDraftStarts } from "./start-launch-draft.js";

/** A launch draft as a surface shows it: whose it is, its buttons' reference and its lines. */
export interface LaunchDraftShowing {
  readonly agent: Id<"agt">;
  readonly agentName: string;
  /** The reference its Start and Drop buttons carry. */
  readonly ref: string;
  readonly lines: readonly CardLine[];
  readonly assets: AssetInfos;
  readonly expiresAtMs: number;
  /**
   * The owner's photo the draft holds, by the `tg:<file_id>` its message named, which a surface
   * shows the owner before the draft (decision 0286); absent for a picture link.
   */
  readonly photo?: string;
}

/**
 * How a press of a launch draft's button stands. `starting`: the owner's Start took the draft, and
 * its launch is being proposed; `chat/launchDraftClosed` says how that went. `dropped`: the owner
 * dropped it. `expired`: its 10 minutes ran out before the press. `launched`: the engine holds no
 * draft of this reference, which a restart forgets, but its Start proposed a launch (decision
 * 0288), which goes on from its card, or ended before it with `endedBeforeCard`. `unknown`: no
 * open draft has this reference and it started nothing, or the presser is not the owner; nothing
 * happened.
 */
export type LaunchDraftStanding =
  | { readonly status: "starting" }
  | {
      readonly status: "launched";
      readonly intent: Id<"int">;
      /** Why the launch ended before its card opened; absent while it goes on or once carded. */
      readonly endedBeforeCard?: IntentReason;
    }
  | { readonly status: "dropped" }
  | { readonly status: "expired" }
  | { readonly status: "unknown" };

/** The engine's open launch drafts, as the owner's surfaces show them and the owner answers. */
export interface LaunchDraftDesk {
  /** The open draft with this id, as its message shows it; `undefined` once it ended. */
  showing(id: string): LaunchDraftShowing | undefined;
  /**
   * Starts the draft whose Start the owner pressed (decision 0285), for the owner's numeric
   * Telegram id alone: it ends at once, so no other press starts it, and answers `starting` while
   * its request is proposed in the background, as the owner on Telegram with the owner's photo put
   * on the upload shelf under the owner's Telegram credential (decision 0286), within its own
   * time. `chat/launchDraftClosed` tells how the proposal went.
   */
  start(
    ref: string,
    presserId: number,
    options: { readonly signal: AbortSignal },
  ): Promise<LaunchDraftStanding>;
  /** Drops the draft whose Drop the owner pressed, for the owner's numeric Telegram id alone. */
  drop(
    ref: string,
    presserId: number,
    options: { readonly signal: AbortSignal },
  ): Promise<LaunchDraftStanding>;
  /** Resolves once every launch Start began has been proposed or stopped. */
  idle(): Promise<void>;
  /** Stops the launches Start began that are still being proposed, and waits for them. */
  close(): Promise<void>;
  /** Ends every draft whose time is up, and answers when the next one's is. */
  expire(): number | undefined;
}

/** What the desk keeps, draws, uploads and proposes through. */
export interface LaunchDraftDeskOptions {
  readonly shelf: LaunchDraftShelf;
  readonly host: Pick<LaunchHost, "picturePlace">;
  readonly chains: ChainRegistry;
  /** The owner's uploads, which the launch from a draft reads its picture from. */
  readonly uploads: Pick<UploadShelf, "ticket" | "receive" | "drop">;
  readonly propose: EngineHandler<"intent/propose">;
  /** The stored launches, which a press of a draft no longer held finds by its reference. */
  readonly intents: Pick<IntentStore, "byDraftRef" | "cards">;
  /** The owner's numeric Telegram id, which alone starts or drops a draft. */
  readonly owners: Pick<OwnerStore, "get">;
  readonly clock: Clock;
  readonly publish: PublishPush;
  /** How long one launch Start began may take to be proposed: 2 minutes when absent. */
  readonly startTimeoutMs?: number;
}

const isStanding = (taken: LaunchDraft | LaunchDraftStanding): taken is LaunchDraftStanding =>
  "status" in taken;

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

// Where the launch a draft's Start proposed stands, for a draft the engine no longer holds: a
// reference that started nothing is `unknown`.
async function launchedBy(
  options: LaunchDraftDeskOptions,
  ref: string,
  call: { readonly signal: AbortSignal },
): Promise<LaunchDraftStanding> {
  const launch = await options.intents.byDraftRef(ref, call);
  if (launch === undefined) {
    return { status: "unknown" };
  }
  const isEnded = isTerminalState(launch.state);
  const cards = isEnded ? await options.intents.cards(launch.id, call) : [];
  const reason = isEnded && cards.length === 0 ? launch.reason : undefined;
  const ended = reason === undefined ? {} : { endedBeforeCard: reason };
  return { status: "launched", intent: launch.id, ...ended };
}

// The draft a press names, taken only for a press of the owner's numeric Telegram id; one the
// engine no longer holds answers where the launch it started stands.
async function pressedByOwner(
  options: LaunchDraftDeskOptions,
  press: { readonly ref: string; readonly presserId: number },
  call: { readonly signal: AbortSignal },
): Promise<LaunchDraft | LaunchDraftStanding> {
  call.signal.throwIfAborted();
  const owner = await options.owners.get(call);
  if (owner?.userId !== press.presserId) {
    return { status: "unknown" };
  }
  const taken = pressed(options, press.ref);
  return isStanding(taken) && taken.status === "unknown"
    ? launchedBy(options, press.ref, call)
    : taken;
}

/** Creates the {@link LaunchDraftDesk} over the engine's open drafts. */
export function createLaunchDraftDesk(options: LaunchDraftDeskOptions): LaunchDraftDesk {
  const { shelf, host, chains, clock, publish } = options;
  const starts = createDraftStarts(options);
  return {
    showing(id) {
      const draft = shelf.byId(id);
      if (draft === undefined) {
        return undefined;
      }
      const place = host.picturePlace(draft.request.venue);
      const { lines, assets } = drawLaunchDraft(draft, { chains, place });
      const { agentId: agent, agentName, ref, expiresAtMs } = draft;
      const photo = draft.picture === undefined ? {} : { photo: draft.request.image };
      return { agent, agentName, ref, lines, assets, expiresAtMs, ...photo };
    },
    async start(ref, presserId, call) {
      const taken = await pressedByOwner(options, { ref, presserId }, call);
      if (isStanding(taken)) {
        return taken;
      }
      starts.run(taken, presserId);
      return { status: "starting" };
    },
    async drop(ref, presserId, call) {
      const taken = await pressedByOwner(options, { ref, presserId }, call);
      if (isStanding(taken)) {
        return taken;
      }
      publishDraftClosed(publish, taken, { outcome: "dropped" });
      return { status: "dropped" };
    },
    idle: async () => starts.idle(),
    close: async () => starts.close(),
    expire() {
      shelf.takeDue(clock.now()).forEach((draft) => {
        publishDraftClosed(publish, draft, { outcome: "expired" });
      });
      return shelf.nextDueMs();
    },
  };
}
