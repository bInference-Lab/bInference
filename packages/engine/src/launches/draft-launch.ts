import type { Clock, Random, Result } from "@binference/core";
import { err, ok } from "@binference/core";
import {
  type LaunchTokenRequest,
  noUploadImage,
  type ProtocolErrorCode,
  type ResultOf,
} from "@binference/protocol";
import type { AgentInboxMessage } from "../chat/agent-inbox-record.js";
import { chatTopic } from "../chat/chat-relay-parts.js";
import { ownerMessagePayloadSchema } from "../chat/inbox-payload.schema.js";
import type { AgentInboxStore, OwnerImageSource } from "../chat/ports.js";
import type { RunningTurns } from "../chat/running-turns.js";
import { launchImageOf, writtenPictureFit } from "../money-path/launch-image.js";
import type { ReadPicture } from "../money-path/launch-upload.js";
import type { LaunchingMoneyPath } from "../money-path/launching-money-path.js";
import type { ResolvedLaunch } from "../money-path/resolve-launch.js";
import type { EngineCall } from "../operations/engine-call.js";
import type { PublishPush } from "../pushes/engine-push.js";
import type { LaunchHost } from "../venues/launch-host.js";
import { publishDraftClosed } from "./launch-draft-closed.js";
import {
  type LaunchDraft,
  launchDraftOpenMs,
  type LaunchDraftShelf,
} from "./launch-draft-shelf.js";

/** What `launch/draft` checks, reads and keeps the draft with (decisions 0285 and 0286). */
export interface DraftLaunchOptions {
  readonly shelf: LaunchDraftShelf;
  readonly moneyPath: Pick<LaunchingMoneyPath, "checkDraft">;
  readonly host: Pick<LaunchHost, "picturePlace" | "pictureBytesFor">;
  /** The token of the runtime's current start, and its agents' running turns. */
  readonly turns: Pick<RunningTurns, "isRuntime" | "runningOf">;
  readonly agentInbox: Pick<AgentInboxStore, "get">;
  /** The owner's images by the names their messages give them, the bot's photos among them. */
  readonly images: OwnerImageSource;
  readonly clock: Clock;
  readonly random: Random;
  readonly publish: PublishPush;
}

type DraftCall = EngineCall<"launch/draft">;

// A draft's id and its buttons' reference: 12 random bytes each, in base64url (decision 0285).
const randomBytes = 12;

// The photo is one the owner sent the bot: an image of the agent's own stored message from
// Telegram, under the name that message gives it (decision 0286).
function isOwnersPhoto(stored: AgentInboxMessage | undefined, agent: string, image: string) {
  if (stored?.kind !== "inbox/message" || stored.agentId !== agent || !image.startsWith("tg:")) {
    return false;
  }
  const payload = ownerMessagePayloadSchema.safeParse(stored.payload);
  return (
    payload.success &&
    payload.data.surface === "telegram" &&
    payload.data.images?.includes(image) === true
  );
}

const refusals = { too_large: "image.too_large", unreadable: "image.unreadable" } as const;

// The photo's bytes, read once and held to what a launch takes: a PNG, JPEG or WebP of at most
// 5 MiB, and for a launchpad that writes it into its create call, one that tells its size and
// fits beside the words (decision 0279).
async function photoOf(
  options: DraftLaunchOptions,
  asked: { readonly request: LaunchTokenRequest; readonly call: DraftCall },
): Promise<Result<ReadPicture | undefined, ProtocolErrorCode>> {
  const { request, call } = asked;
  const { photo, agent } = call.args;
  if (photo === undefined) {
    return ok(undefined);
  }
  const stored = await options.agentInbox.get(photo.message, call);
  if (!isOwnersPhoto(stored, agent, photo.image)) {
    return err("image.not_found");
  }
  const read = await options.images.read(photo.image, call);
  if (!read.ok) {
    return err(refusals[read.error]);
  }
  const image = launchImageOf(read.value);
  if (image === undefined) {
    return err("image.format");
  }
  if (options.host.picturePlace(request.venue) !== "create_call") {
    return ok({ bytes: read.value, image });
  }
  const fit = writtenPictureFit(image, options.host.pictureBytesFor(request.venue, request) ?? 0);
  if (fit === "unsized") {
    return err("image.unreadable");
  }
  return fit === "too_large"
    ? err("intent.launch_picture_too_large")
    : ok({ bytes: read.value, image });
}

const randomText = (random: Random): string =>
  Buffer.from(random.bytes(randomBytes)).toString("base64url");

/**
 * `launch/draft` (decision 0285): only the runtime the engine runs now, in its agent's running
 * turn, drafts (else `auth.scope` or `protocol.bad_args`). The launch is checked as a proposal is,
 * its photo read once from the owner's own message (decision 0286), and the draft kept for 10
 * minutes, replacing the agent's open one; `chat/launchDraft` tells the owner's surfaces. Nothing
 * is uploaded, quoted or stored.
 */
export async function draftLaunch(
  options: DraftLaunchOptions,
  call: DraftCall,
): Promise<Result<ResultOf<"launch/draft">, ProtocolErrorCode>> {
  const { agent, turn, launch, photo } = call.args;
  if (!options.turns.isRuntime(call.caller.credential)) {
    return err("auth.scope");
  }
  if (options.turns.runningOf(agent)?.turn !== turn) {
    return err("protocol.bad_args");
  }
  const image = photo?.image ?? noUploadImage;
  const request: LaunchTokenRequest = { ...launch, kind: "launchToken", agent, image };
  const checked = await options.moneyPath.checkDraft(request, call.signal);
  if (!checked.ok) {
    return checked;
  }
  const picture = await photoOf(options, { request, call });
  if (!picture.ok) {
    return picture;
  }
  return ok(keep(options, { request, resolved: checked.value, picture: picture.value }));
}

// Keeps the draft, ending the agent's open one as replaced, and tells the owner's surfaces.
function keep(
  options: DraftLaunchOptions,
  made: {
    readonly request: LaunchTokenRequest;
    readonly resolved: ResolvedLaunch;
    readonly picture: ReadPicture | undefined;
  },
): ResultOf<"launch/draft"> {
  const { request, resolved, picture } = made;
  const draft: LaunchDraft = {
    id: randomText(options.random),
    ref: randomText(options.random),
    agentId: request.agent,
    agentName: resolved.settings.agent.name,
    request,
    settings: resolved.launchSettings,
    ...(picture === undefined ? {} : { picture }),
    hasOutsideContent: options.turns.runningOf(request.agent)?.hasOutsideContent ?? true,
    expiresAtMs: options.clock.now() + launchDraftOpenMs,
  };
  const replaced = options.shelf.put(draft);
  if (replaced !== undefined) {
    publishDraftClosed(options.publish, replaced, { outcome: "replaced" });
  }
  const data = { agent: request.agent, draft: draft.id, expiresAt: draft.expiresAtMs };
  options.publish({ topic: chatTopic(request.agent), kind: "chat/launchDraft", data });
  return { draft: draft.id, expiresAt: draft.expiresAtMs };
}
