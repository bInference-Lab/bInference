import { BinferenceError, maxUrlChars } from "@binference/core";
import { maxImageBytes, maxImagesPerMessage } from "@binference/protocol";
import { z } from "zod";
import type { ImageLookRefusal, ToolOutcome, ToolRunContext } from "../loop/turn-records.js";
import { agentToolTexts } from "./agent-tool-texts.js";
import { type AgentTool, defineTool } from "./define-tool.js";
import {
  type ImagePlace,
  imagePlaceOf,
  imageReadFailed,
  imageRefusals,
  readImages,
} from "./image-places.js";
import { failedAnswer } from "./tool-answer.js";
import type { AgentToolParts } from "./tool-client.js";

/** The args of `look_at_image`: images by address or file, and what to look for. */
interface LookAtImageArgs {
  readonly url?: string;
  readonly path?: string;
  readonly paths?: readonly string[];
  readonly question?: string;
}

const maxPathChars = 1_024;
const maxQuestionChars = 1_000;
const pathText = z.string().trim().min(1).max(maxPathChars);

const lookArgs: z.ZodType<LookAtImageArgs> = z.strictObject({
  url: z
    .string()
    .trim()
    .min(1)
    .max(maxUrlChars + maxImageBytes * 2)
    .exactOptional(),
  path: pathText.exactOptional(),
  paths: z.array(pathText).max(maxImagesPerMessage).exactOptional(),
  question: z.string().trim().min(1).max(maxQuestionChars).exactOptional(),
});

const lookRefusals: Readonly<Record<ImageLookRefusal, string>> = {
  no_model:
    "No model of this agent can see images: the owner sets one in models.imageInput or models.vision. Tell the owner.",
  failed: "The model that looks at images did not answer. Try again later.",
};

const defaultQuestion = "What does it show?";

/**
 * Reads images through the engine's `image/view`, or from their `data:` URLs, and answers a
 * model's description of them together, asked `question`; a refusal reads as its sentence. Used by
 * `look_at_image` and by `file_read` for an image file.
 */
export async function lookAtPlaces(
  parts: Pick<AgentToolParts, "agent" | "client">,
  places: readonly ImagePlace[],
  context: Pick<ToolRunContext, "signal" | "look"> & { readonly question: string },
): Promise<ToolOutcome> {
  const { signal, look, question } = context;
  try {
    const read = await readImages(parts, places, signal);
    if (!read.ok) {
      return imageReadFailed(read.error);
    }
    const images = read.value;
    const seen = await look(images, question);
    return seen.ok
      ? { text: seen.value, isError: false }
      : { text: lookRefusals[seen.error], isError: true };
  } catch (error) {
    if (!(error instanceof BinferenceError)) {
      throw error;
    }
    return imageRefusals[error.code] === undefined
      ? failedAnswer("look_at_image", error)
      : imageReadFailed(error.code);
  }
}

// Every place a call names: its address, its path, then its paths.
function placesOf(args: LookAtImageArgs): readonly ImagePlace[] {
  return [
    ...(args.url === undefined ? [] : [imagePlaceOf({ url: args.url })]),
    ...(args.path === undefined ? [] : [imagePlaceOf({ path: args.path })]),
    ...(args.paths ?? []).map((path) => imagePlaceOf({ path })),
  ];
}

/**
 * `look_at_image`, a read tool (decision 0385): reads up to 4 PNG, JPEG or WebP images of at most
 * 5 MiB each, from public addresses, `data:` URLs or files on the engine's machine read as the
 * file tools read them, and answers a model's description of them, with the question the agent
 * asked. Every answer is outside content: an image may hold any words.
 */
export function lookAtImageTool({ agent, client }: AgentToolParts): AgentTool {
  return defineTool({
    name: "look_at_image",
    kind: "read",
    outside: true,
    description: agentToolTexts.look_at_image,
    args: lookArgs,
    run: async (args, { signal, look }) => {
      const places = placesOf(args);
      if (places.length === 0 || places.length > maxImagesPerMessage) {
        const most = String(maxImagesPerMessage);
        return { text: `Name 1 to ${most} images: url, path or paths.`, isError: true };
      }
      return lookAtPlaces({ agent, client }, places, {
        signal,
        look,
        question: args.question ?? defaultQuestion,
      });
    },
  });
}
