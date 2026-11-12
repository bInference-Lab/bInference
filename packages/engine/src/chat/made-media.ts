import { err, type Id, jsonValueSchema, ok, type Result } from "@binference/core";
import {
  type ArgsOf,
  maxVideoBytes,
  maxVoiceBytes,
  type MediaContentType,
  type MediaKind,
  mediaTypeOf,
  type MediaView,
  type ProtocolErrorCode,
} from "@binference/protocol";
import type { EngineCall, EngineHandler } from "../operations/engine-call.js";
import { addPart, type Arriving } from "./arriving-parts.js";
import { chatTopic } from "./chat-relay-parts.js";
import { wakeForRuntime } from "./engine-message.js";
import { keepBounded } from "./keep-bounded.js";
import { createMediaReads, type MediaOptions, type MediaState } from "./media-reads.js";

/** The operations of the videos and speech the agent makes (decision 0405). */
export interface MadeMediaHandlers {
  readonly "media/store": EngineHandler<"media/store">;
  readonly "media/made": EngineHandler<"media/made">;
  readonly "media/send": EngineHandler<"media/send">;
  readonly "media/read": EngineHandler<"media/read">;
  readonly "speech/local": EngineHandler<"speech/local">;
}

export type { MediaOptions } from "./media-reads.js";

// How many media arrive at once, each up to 100 MiB in memory, and how long one may take.
const mostArriving = 2;
const arrivingMs = 15 * 60_000;
const mostSaved = 64;

const maxBytes: Readonly<Record<MediaKind, number>> = {
  video: maxVideoBytes,
  voice: maxVoiceBytes,
};

const extensions: Readonly<Record<MediaContentType, string>> = {
  "video/mp4": "mp4",
  "audio/ogg": "ogg",
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
};

const folders: Readonly<Record<MediaKind, string>> = {
  video: "media/made",
  voice: "media/speech",
};

// The text the agent reads when its video is ready, or why none was made.
function madeText(prompt: string, made: MediaView | undefined, failed: string): string {
  if (made === undefined) {
    return `[binference: making a video for "${prompt}" failed: ${failed}. Tell the owner in a line; try again only if they ask.]`;
  }
  return `[binference: the video you made for "${prompt}" is ready. The owner sees it in the chat now; it is saved at ${made.path}. Say in a line what you made, if anything; never repeat the prompt.]`;
}

// The medium's bytes so far with this part's bytes added, or why the part does not fit.
function arrived(
  arriving: Map<string, Arriving>,
  args: ArgsOf<"media/store">,
  nowMs: number,
): Result<Arriving, ProtocolErrorCode> {
  if (args.total > maxBytes[args.kind]) {
    return err("media.too_large");
  }
  const arrival = { key: `${args.agent}/${args.job}`, part: args };
  return addPart(arriving, arrival, { nowMs, arrivingMs, mostArriving });
}

/** A whole medium to save: whose, what kind, and its bytes. */
interface Whole {
  readonly agent: Id<"agt">;
  readonly kind: MediaKind;
  readonly bytes: Readonly<Uint8Array>;
}

// Saves a whole medium in the agent's workspace, its format read from its first bytes.
async function saveMedia(
  { options, state }: { readonly options: MediaOptions; readonly state: MediaState },
  whole: Whole,
  signal: AbortSignal,
): Promise<Result<MediaView, ProtocolErrorCode>> {
  const files = options.madeImageFiles;
  const contentType = mediaTypeOf(whole.bytes, whole.kind);
  if (files === undefined || contentType === undefined) {
    return err(files === undefined ? "media.unreadable" : "media.format");
  }
  const id = Buffer.from(options.random.bytes(8)).toString("hex");
  const day = new Date(options.clock.now()).toISOString().slice(0, 10);
  const relative = `${folders[whole.kind]}/${day}/${id}.${extensions[contentType]}`;
  const written = await files.write(relative, whole.bytes, {
    signal,
    workspaceOnly: true,
    createOnly: true,
  });
  if (!written.ok) {
    return err("media.unreadable");
  }
  const view = {
    media: id,
    kind: whole.kind,
    contentType,
    bytes: whole.bytes.byteLength,
    path: written.value,
  };
  keepBounded(state.saved, [id, { agent: whole.agent, view }], mostSaved);
  return ok(view);
}

function storeHandler(
  options: MediaOptions,
  state: MediaState & { readonly arriving: Map<string, Arriving> },
): EngineHandler<"media/store"> {
  return async (call) => {
    if (!options.turns.isRuntime(call.caller.credential)) {
      return err("auth.scope");
    }
    const part = arrived(state.arriving, call.args, options.clock.now());
    if (!part.ok || part.value.received < call.args.total) {
      return part.ok ? ok({}) : part;
    }
    const { agent, kind } = call.args;
    const saved = await saveMedia({ options, state }, { agent, kind, ...part.value }, call.signal);
    return saved.ok ? ok({ media: saved.value }) : saved;
  };
}

// Pushes a saved medium of the agent on its chat topic, as `chat/media`.
function pushMedia(
  options: MediaOptions,
  at: { readonly agent: Id<"agt">; readonly turn: string },
  view: MediaView,
): void {
  const data = jsonValueSchema.parse({ agent: at.agent, turn: at.turn, media: view });
  options.publish({ topic: chatTopic(at.agent), kind: "chat/media", data });
}

// The agent's saved video a job ended with, none when it named none, or `media.not_found`.
function videoOf(
  state: MediaState,
  agent: Id<"agt">,
  media: string | undefined,
): Result<MediaView | undefined, ProtocolErrorCode> {
  if (media === undefined) {
    return ok(undefined);
  }
  const kept = state.saved.get(media);
  return kept?.agent === agent && kept.view.kind === "video"
    ? ok(kept.view)
    : err("media.not_found");
}

function madeHandler(options: MediaOptions, state: MediaState): EngineHandler<"media/made"> {
  return async (call) => {
    if (!options.turns.isRuntime(call.caller.credential)) {
      return err("auth.scope");
    }
    const { agent, turn, prompt, media, failed, surface } = call.args;
    const video = videoOf(state, agent, media);
    if (!video.ok) {
      return video;
    }
    if (video.value !== undefined) {
      pushMedia(options, { agent, turn }, video.value);
    }
    const text = madeText(prompt, video.value, failed ?? "no video came back");
    return wakeForRuntime(options, { agent, text, surface }, call.signal);
  };
}

function sendHandler(options: MediaOptions, state: MediaState): EngineHandler<"media/send"> {
  return async (call) => {
    if (!options.turns.isRuntime(call.caller.credential)) {
      return err("auth.scope");
    }
    const { agent, turn, media } = call.args;
    const kept = state.saved.get(media);
    if (kept?.agent !== agent) {
      return err("media.not_found");
    }
    pushMedia(options, { agent, turn }, kept.view);
    return Promise.resolve(ok({}));
  };
}

function localSpeechHandler(
  options: MediaOptions,
  state: MediaState,
): EngineHandler<"speech/local"> {
  return async (call: EngineCall<"speech/local">) => {
    if (!options.turns.isRuntime(call.caller.credential)) {
      return err("auth.scope");
    }
    const { agent, text, voice } = call.args;
    if (options.localVoice === undefined) {
      return err("speech.local_unavailable");
    }
    const request = { text, ...(voice === undefined ? {} : { voice }) };
    const spoken = await options.localVoice.speak(request, { signal: call.signal });
    if (!spoken.ok) {
      return err(spoken.error === "unavailable" ? "speech.local_unavailable" : "speech.failed");
    }
    const whole = { agent, kind: "voice" as const, bytes: spoken.value };
    const saved = await saveMedia({ options, state }, whole, call.signal);
    return saved.ok ? ok({ media: saved.value }) : saved;
  };
}

/**
 * Creates the operations of the videos and speech the agent makes (decision 0405). Each but
 * `media/read` answers only the runtime the engine runs now. `media/store` takes a medium in
 * parts, in order, a video of at most 100 MiB or speech of at most 20 MiB, and saves a whole one
 * in the agent's workspace, a video under `media/made/<date>/` and speech under
 * `media/speech/<date>/`, its format read from its first bytes; `speech/local` speaks words with
 * the machine's own voice and saves them the same way. `media/made` ends a video job: it pushes
 * the video as `chat/media` and wakes the agent with a message saying it is ready or why none was
 * made. `media/send` pushes a saved medium as `chat/media` with no wake-up. `media/read` answers a
 * saved medium's parts by its id to a surface, read again where it was saved. The ids of the last
 * 64 media are kept in memory.
 */
export function createMadeMediaHandlers(options: MediaOptions): MadeMediaHandlers {
  const state = { arriving: new Map<string, Arriving>(), ...createMediaReads(options) };
  return {
    "media/store": storeHandler(options, state),
    "media/made": madeHandler(options, state),
    "media/send": sendHandler(options, state),
    "media/read": state.readHandler,
    "speech/local": localSpeechHandler(options, state),
  };
}
