import { err } from "@binference/core";
import type { ProtocolErrorCode } from "@binference/protocol";
import type { EngineHandler } from "../operations/engine-call.js";
import { createImageHold, type HoldRefusal, type ImageHold } from "./image-hold.js";
import { readHeldPart } from "./image-part.js";
import type { ViewedImagePlace, ViewImageRefusal, ViewImageSource } from "./ports.js";
import type { RunningTurns } from "./running-turns.js";

/** The operation the agent looks at an image with (protocol spec, section 7.7). */
export interface ViewImageHandlers {
  readonly "image/view": EngineHandler<"image/view">;
}

/** What `image/view` reads through. */
export interface ViewImageOptions {
  /** The token of the runtime's current start, the one caller the handler answers. */
  readonly turns: Pick<RunningTurns, "isRuntime">;
  /** Where viewed images come from; without it, every view is `image.unreadable`. */
  readonly source?: ViewImageSource;
  readonly clock: Parameters<typeof createImageHold>[0]["clock"];
}

const refusalCodes: Readonly<Record<HoldRefusal<ViewImageRefusal>, ProtocolErrorCode>> = {
  too_large: "image.too_large",
  unreadable: "image.unreadable",
  format: "image.format",
  not_found: "image.not_found",
  walled: "image.walled",
  outside_workspace: "image.outside_workspace",
  not_public: "image.not_public",
};

// The hold names an image by one text: its kind and where it is.
function placeOf(name: string): ViewedImagePlace {
  return name.startsWith("url:") ? { url: name.slice(4) } : { path: name.slice(5) };
}

function holdOf(options: ViewImageOptions): ImageHold<ViewImageRefusal> | undefined {
  const { source, clock } = options;
  if (source === undefined) {
    return undefined;
  }
  return createImageHold<ViewImageRefusal>({
    source: { read: async (name, call) => source.read(placeOf(name), call) },
    clock,
  });
}

/**
 * Creates the handler of `image/view` (decision 0385): only the runtime the engine runs now reads,
 * part by part from a hold, so an address is fetched once. The source refuses a private address,
 * a path inside binference's own folder and an image over 5 MiB; a format the agent cannot read is
 * `image.format`. An offset past the image is `protocol.bad_args`.
 */
export function createViewImageHandlers(options: ViewImageOptions): ViewImageHandlers {
  const hold = holdOf(options);
  return {
    async "image/view"(call) {
      if (!options.turns.isRuntime(call.caller.credential)) {
        return err("auth.scope");
      }
      if (hold === undefined) {
        return err("image.unreadable");
      }
      const { agent, url, path, offset = 0 } = call.args;
      const name = url === undefined ? `path:${path ?? ""}` : `url:${url}`;
      return readHeldPart(
        { hold, codes: refusalCodes },
        { key: `${agent} ${name}`, image: name, offset },
        call,
      );
    },
  };
}
