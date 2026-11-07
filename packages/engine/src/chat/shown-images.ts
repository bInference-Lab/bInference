import { err, type Id, jsonValueSchema, ok, type Result } from "@binference/core";
import { imageTypeOf, type ProtocolErrorCode } from "@binference/protocol";
import type { EngineHandler } from "../operations/engine-call.js";
import { chatTopic } from "./chat-relay-parts.js";
import type { MadeImageOptions, MadeImageView } from "./made-images.js";
import type { ViewImageRefusal } from "./ports.js";

const refusalCodes: Readonly<Record<ViewImageRefusal, ProtocolErrorCode>> = {
  too_large: "image.too_large",
  unreadable: "image.unreadable",
  not_found: "image.not_found",
  walled: "image.walled",
  outside_workspace: "image.outside_workspace",
  not_public: "image.not_public",
};

// One image read where it is, through the walls `image/view` keeps, and given an id.
async function viewOf(
  options: MadeImageOptions,
  path: string,
  signal: AbortSignal,
): Promise<Result<MadeImageView, ProtocolErrorCode>> {
  const source = options.viewImages;
  if (source === undefined) {
    return err("image.unreadable");
  }
  const read = await source.read({ path }, { signal });
  if (!read.ok) {
    return err(refusalCodes[read.error]);
  }
  const contentType = imageTypeOf(read.value);
  if (contentType === undefined) {
    return err("image.format");
  }
  const image = Buffer.from(options.random.bytes(8)).toString("hex");
  return ok({ image, contentType, bytes: read.value.byteLength, path });
}

/**
 * The handler of `image/show` (decision 0399): only the runtime the engine runs now shows images,
 * each already on the machine, read as `image/view` reads a path, so binference's own folder stays
 * walled off. Every image must read before any is shown; the first that cannot refuses the call
 * with its code. The images go out as `chat/images` on the agent's chat topic, each kept by `keep`
 * so a surface reads it by its id, and nothing wakes the agent.
 */
export function showHandler(
  options: MadeImageOptions,
  keep: (agent: Id<"agt">, view: MadeImageView) => void,
): EngineHandler<"image/show"> {
  return async (call) => {
    if (!options.turns.isRuntime(call.caller.credential)) {
      return err("auth.scope");
    }
    const { agent, turn, paths, caption } = call.args;
    const views: MadeImageView[] = [];
    for (const path of paths) {
      // oxlint-disable-next-line eslint/no-await-in-loop -- each file is read in turn, and the first refusal stops the rest
      const view = await viewOf(options, path, call.signal);
      if (!view.ok) {
        return view;
      }
      views.push(view.value);
    }
    for (const view of views) {
      keep(agent, view);
    }
    const data = jsonValueSchema.parse({ agent, turn, prompt: caption, images: views });
    options.publish({ topic: chatTopic(agent), kind: "chat/images", data });
    return ok({ images: views.map(({ image, path }) => ({ image, path })) });
  };
}
