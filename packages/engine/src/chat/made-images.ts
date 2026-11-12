import { err, type Id, jsonValueSchema, ok, type Result } from "@binference/core";
import {
  type ArgsOf,
  type ImageContentType,
  imageTypeOf,
  type ChatPush,
  type ProtocolErrorCode,
} from "@binference/protocol";
import type { MachineFiles } from "../files/ports.js";
import type { EngineCall, EngineHandler } from "../operations/engine-call.js";
import { addPart, type Arriving } from "./arriving-parts.js";
import { type ChatRelayOptions, chatTopic } from "./chat-relay-parts.js";
import { wakeForRuntime } from "./engine-message.js";
import { imagePartOf } from "./image-part.js";
import { keepBounded } from "./keep-bounded.js";
import { showHandler } from "./shown-images.js";

/** An image the agent made or showed, as `chat/images` names it. */
export type MadeImageView = Extract<ChatPush, { readonly kind: "chat/images" }>["images"][number];

/** The operations of the images the agent makes (decision 0392). */
export interface MadeImageHandlers {
  readonly "image/store": EngineHandler<"image/store">;
  readonly "image/made": EngineHandler<"image/made">;
  readonly "image/read": EngineHandler<"image/read">;
  readonly "image/show": EngineHandler<"image/show">;
}

/** What the made images are kept and told through. */
export type MadeImageOptions = Pick<
  ChatRelayOptions,
  | "agentInbox"
  | "inboxHold"
  | "turns"
  | "ids"
  | "clock"
  | "publish"
  | "intentView"
  | "random"
  | "viewImages"
> & {
  /** The agent's files, where made images are saved; without them every store is refused. */
  readonly madeImageFiles?: Pick<MachineFiles, "read" | "write">;
};

/** A made image the engine saved, by its id. */
interface SavedImage {
  readonly agent: Id<"agt">;
  readonly view: MadeImageView;
  /** Whether it was saved in the workspace, or shown from where it already was (decision 0399). */
  readonly kept: "workspace" | "shown";
}

// How many images arrive at once, how long one may take, and how many saved ones keep an id.
const mostArriving = 8;
const arrivingMs = 10 * 60_000;
const mostSaved = 64;

const extensions: Readonly<Record<ImageContentType, string>> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

// The text the agent reads when its images are ready, or why none was made.
function madeText(prompt: string, made: readonly MadeImageView[], failed?: string): string {
  if (failed !== undefined) {
    return `[binference: making images for "${prompt}" failed: ${failed}. Tell the owner in a line; try again only if they ask.]`;
  }
  const paths = made.map((image) => image.path).join(", ");
  const ready =
    made.length === 1
      ? `the image you made for "${prompt}" is ready. The owner sees it in the chat now; it is saved at ${paths}.`
      : `the ${String(made.length)} images you made for "${prompt}" are ready. The owner sees them in the chat now; they are saved at ${paths}.`;
  return `[binference: ${ready} Say in a line what you made, if anything; never repeat the prompt, and look at an image with look_at_image only if the owner asks about it.]`;
}

/** The made images' state: those arriving and those saved, each bounded. */
interface MadeState {
  readonly arriving: Map<string, Arriving>;
  readonly saved: Map<string, SavedImage>;
}

// The image's bytes so far with this part's bytes added, or why the part does not fit.
function arrived(
  state: MadeState,
  args: ArgsOf<"image/store">,
  nowMs: number,
): Result<Arriving, ProtocolErrorCode> {
  const arrival = { key: `${args.agent}/${args.job}/${String(args.place)}`, part: args };
  return addPart(state.arriving, arrival, { nowMs, arrivingMs, mostArriving });
}

// Saves a whole made image in the agent's workspace and gives it an id.
async function saveImage(
  { options, state }: { readonly options: MadeImageOptions; readonly state: MadeState },
  image: { readonly agent: Id<"agt">; readonly bytes: Readonly<Uint8Array> },
  call: EngineCall<"image/store">,
): Promise<Result<MadeImageView, ProtocolErrorCode>> {
  const files = options.madeImageFiles;
  const contentType = imageTypeOf(image.bytes);
  if (files === undefined || contentType === undefined) {
    return err(files === undefined ? "image.unreadable" : "image.format");
  }
  const id = Buffer.from(options.random.bytes(8)).toString("hex");
  const day = new Date(options.clock.now()).toISOString().slice(0, 10);
  const relative = `media/made/${day}/${id}.${extensions[contentType]}`;
  const written = await files.write(relative, image.bytes, {
    signal: call.signal,
    workspaceOnly: true,
    createOnly: true,
  });
  if (!written.ok) {
    return err("image.unreadable");
  }
  const view = { image: id, contentType, bytes: image.bytes.byteLength, path: written.value };
  keepBounded(state.saved, [id, { agent: image.agent, view, kept: "workspace" }], mostSaved);
  return ok(view);
}

function storeHandler(options: MadeImageOptions, state: MadeState): EngineHandler<"image/store"> {
  return async (call) => {
    if (!options.turns.isRuntime(call.caller.credential)) {
      return err("auth.scope");
    }
    const part = arrived(state, call.args, options.clock.now());
    if (!part.ok || part.value.received < call.args.total) {
      return part.ok ? ok({}) : part;
    }
    const image = { agent: call.args.agent, bytes: part.value.bytes };
    const view = await saveImage({ options, state }, image, call);
    return view.ok ? ok({ image: view.value.image, path: view.value.path }) : view;
  };
}

function madeHandler(options: MadeImageOptions, state: MadeState): EngineHandler<"image/made"> {
  return async (call) => {
    if (!options.turns.isRuntime(call.caller.credential)) {
      return err("auth.scope");
    }
    const { agent, turn, prompt, images, failed, surface } = call.args;
    const views = images.map((id) => state.saved.get(id));
    const shown = views.flatMap((each) => (each?.agent === agent ? [each.view] : []));
    if (shown.length !== images.length) {
      return err("image.not_found");
    }
    if (shown.length > 0) {
      const data = jsonValueSchema.parse({ agent, turn, prompt, images: shown });
      options.publish({ topic: chatTopic(agent), kind: "chat/images", data });
    }
    const text = madeText(
      prompt,
      shown,
      shown.length === 0 ? (failed ?? "no image came back") : undefined,
    );
    return wakeForRuntime(options, { agent, text, surface }, call.signal);
  };
}

// A kept image's bytes, read again where it is: a shown one through the walls `image/view` keeps.
async function bytesOf(
  options: MadeImageOptions,
  kept: SavedImage,
  signal: AbortSignal,
): Promise<Uint8Array | undefined> {
  if (kept.kept === "shown") {
    const read = await options.viewImages?.read({ path: kept.view.path }, { signal });
    return read?.ok === true ? read.value : undefined;
  }
  const workspace = { signal, workspaceOnly: true, maxBytes: kept.view.bytes };
  const read = await options.madeImageFiles?.read(kept.view.path, workspace);
  return read?.ok === true ? read.value.bytes : undefined;
}

function readHandler(options: MadeImageOptions, state: MadeState): EngineHandler<"image/read"> {
  return async (call) => {
    const { agent, image, offset = 0 } = call.args;
    const kept = state.saved.get(image);
    if (kept?.agent !== agent) {
      return err("image.not_found");
    }
    const bytes = await bytesOf(options, kept, call.signal);
    if (bytes === undefined) {
      return err("image.not_found");
    }
    if (offset >= bytes.byteLength) {
      return err("protocol.bad_args");
    }
    return ok(imagePartOf({ contentType: kept.view.contentType, bytes }, offset));
  };
}

/**
 * Creates the operations of the images the agent makes (decision 0392). `image/store` takes each
 * made image in parts, in order, from the current runtime only, and saves a whole one in the
 * agent's workspace under `media/made/<date>/`, its format read from its first bytes; `image/made`
 * pushes the job's images on the agent's chat topic as `chat/images` and wakes the agent with a
 * message saying they are ready or why none was made; `image/show` pushes images already on the
 * machine the same way (decision 0399); `image/read` answers a saved or shown image's parts by its
 * id to a surface, read again where it is. The ids of the last 64 images are kept in memory.
 */
export function createMadeImageHandlers(options: MadeImageOptions): MadeImageHandlers {
  const state: MadeState = { arriving: new Map(), saved: new Map() };
  return {
    "image/store": storeHandler(options, state),
    "image/made": madeHandler(options, state),
    "image/read": readHandler(options, state),
    "image/show": showHandler(options, (agent, view) => {
      keepBounded(state.saved, [view.image, { agent, view, kept: "shown" }], mostSaved);
    }),
  };
}
