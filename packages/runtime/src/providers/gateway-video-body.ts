import type { GatewayVideoModel } from "./gateway-video-models.schema.js";

/** What the agent asks the video model for (decision 0405). */
export interface VideoMakingRequest {
  readonly prompt: string;
  /** The length in seconds; the model's shortest when absent. */
  readonly seconds?: number;
  /** Such as `720p`; the model's lowest when absent. */
  readonly resolution?: string;
  /** Such as `16:9`; 16:9 when the model takes it, else its first, when absent. */
  readonly aspectRatio?: string;
  /** Sound, on a model that makes it; none when absent. */
  readonly sound?: boolean;
  readonly seed?: number;
  /** Public `https` links of the pictures the video starts and ends on. */
  readonly firstFrame?: string;
  readonly lastFrame?: string;
  /** Public `https` links of pictures of a person, a thing or a look to keep. */
  readonly references: readonly string[];
}

/** A picture by its public link, as the gateway takes one. */
interface PictureLink {
  readonly type: "image_url";
  readonly image_url: { readonly url: string };
}

/** The body of `POST /videos` (decision 0405): only values the model lists. */
export interface GatewayVideoBody {
  readonly model: string;
  readonly prompt: string;
  readonly duration: number;
  readonly resolution: string;
  readonly aspect_ratio: string;
  readonly generate_audio?: true;
  readonly seed?: number;
  readonly frame_images?: readonly (PictureLink & { readonly frame_type: string })[];
  readonly input_references?: readonly PictureLink[];
}

/** A body to send, or why the request cannot be sent to this model, in a line the agent reads. */
export type VideoBodyOutcome =
  | { readonly ok: true; readonly body: GatewayVideoBody }
  | { readonly ok: false; readonly failure: string };

// How tall a size is in lines, so the lowest can be picked: `720p` is 720, `2K` 1440, `4K` 2880.
function linesOf(resolution: string): number {
  const match = /^(\d+)(p|k)$/iu.exec(resolution.trim());
  if (match === null) {
    return Number.MAX_SAFE_INTEGER;
  }
  const size = Number(match[1]);
  return match[2]?.toLowerCase() === "k" ? size * 720 : size;
}

const lowest = (values: readonly string[]): string | undefined =>
  values.toSorted((left, right) => linesOf(left) - linesOf(right))[0];

const listOf = (values: readonly (string | number)[]): string => values.join(", ");

/** The length, size and shape asked for, or the model's least costly ones. */
interface Shape {
  readonly duration: number;
  readonly resolution: string;
  readonly aspectRatio: string;
}

function shapeOf(facts: GatewayVideoModel, request: VideoMakingRequest): Shape | string {
  const duration = request.seconds ?? Math.min(...facts.durations);
  if (!facts.durations.includes(duration)) {
    return `the model makes videos of ${listOf(facts.durations)} seconds; ask for one of them`;
  }
  const resolution = request.resolution ?? lowest(facts.resolutions);
  if (resolution === undefined || !facts.resolutions.includes(resolution)) {
    return `the model makes videos at ${listOf(facts.resolutions)}; ask for one of them`;
  }
  const shape = facts.aspectRatios.includes("16:9") ? "16:9" : facts.aspectRatios[0];
  const aspectRatio = request.aspectRatio ?? shape;
  if (aspectRatio === undefined || !facts.aspectRatios.includes(aspectRatio)) {
    return `the model makes videos shaped ${listOf(facts.aspectRatios)}; ask for one of them`;
  }
  return { duration, resolution, aspectRatio };
}

const linked = (url: string): PictureLink => ({ type: "image_url", image_url: { url } });

// Why the pictures cannot go to this model, or none when they can.
function picturesRefusal(
  facts: GatewayVideoModel,
  request: VideoMakingRequest,
): string | undefined {
  const frames = [request.firstFrame, request.lastFrame].filter((url) => url !== undefined);
  if (frames.length > 0 && request.references.length > 0) {
    return "frame pictures and references cannot go together; use one or the other";
  }
  if (request.firstFrame !== undefined && !facts.frames.includes("first_frame")) {
    return "the model starts on no picture you give; leave out firstFrame";
  }
  if (request.lastFrame !== undefined && !facts.frames.includes("last_frame")) {
    return "the model ends on no picture you give; leave out lastFrame";
  }
  if (request.references.length > facts.maxReferences) {
    return `the model takes at most ${String(facts.maxReferences)} references`;
  }
  return undefined;
}

function picturesOf(request: VideoMakingRequest): Partial<GatewayVideoBody> {
  const frames = [
    ...(request.firstFrame === undefined
      ? []
      : [{ ...linked(request.firstFrame), frame_type: "first_frame" }]),
    ...(request.lastFrame === undefined
      ? []
      : [{ ...linked(request.lastFrame), frame_type: "last_frame" }]),
  ];
  return {
    ...(frames.length === 0 ? {} : { frame_images: frames }),
    ...(request.references.length === 0
      ? {}
      : { input_references: request.references.map(linked) }),
  };
}

// Why sound or a seed cannot go to this model, or none when they can.
function extrasRefusal(facts: GatewayVideoModel, request: VideoMakingRequest): string | undefined {
  if (request.sound === true && !facts.sound) {
    return "the model makes no sound; leave out sound";
  }
  return request.seed !== undefined && !facts.seed
    ? "the model takes no seed; leave out seed"
    : undefined;
}

/**
 * The body of `POST /videos` for a model's listed values: the length, size and shape asked for, or
 * the model's shortest length, lowest size and 16:9 when it takes it, so a video costs the least;
 * sound only when asked; frames and references as public links. A value the model does not list is
 * refused in words naming the values it takes, and nothing is sent.
 */
export function gatewayVideoBodyOf(
  model: { readonly name: string; readonly facts: GatewayVideoModel },
  request: VideoMakingRequest,
): VideoBodyOutcome {
  const { facts } = model;
  const shape = shapeOf(facts, request);
  if (typeof shape === "string") {
    return { ok: false, failure: shape };
  }
  const refused = picturesRefusal(facts, request) ?? extrasRefusal(facts, request);
  if (refused !== undefined) {
    return { ok: false, failure: refused };
  }
  return {
    ok: true,
    body: {
      model: model.name,
      prompt: request.prompt,
      duration: shape.duration,
      resolution: shape.resolution,
      aspect_ratio: shape.aspectRatio,
      ...(request.sound === true ? { generate_audio: true } : {}),
      ...(request.seed === undefined ? {} : { seed: request.seed }),
      ...picturesOf(request),
    },
  };
}
