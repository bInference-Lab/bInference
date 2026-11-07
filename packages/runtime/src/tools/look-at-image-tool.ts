import { BinferenceError, maxUrlChars, ok } from "@binference/core";
import { z } from "zod";
import { readPagedImage } from "../images/paged-image.js";
import type { ImageLookRefusal, ToolOutcome } from "../loop/turn-records.js";
import { agentToolTexts } from "./agent-tool-texts.js";
import { type AgentTool, defineTool } from "./define-tool.js";
import { failedAnswer } from "./tool-answer.js";
import type { AgentToolParts } from "./tool-client.js";

/** The args of `look_at_image`: one image by its address or its file, and what to look for. */
interface LookAtImageArgs {
  readonly url?: string;
  readonly path?: string;
  readonly question?: string;
}

const maxPathChars = 1_024;
const maxQuestionChars = 1_000;

const lookArgs: z.ZodType<LookAtImageArgs> = z
  .strictObject({
    url: z.string().trim().min(1).max(maxUrlChars).exactOptional(),
    path: z.string().trim().min(1).max(maxPathChars).exactOptional(),
    question: z.string().trim().min(1).max(maxQuestionChars).exactOptional(),
  })
  .refine((args) => (args.url === undefined) !== (args.path === undefined), {
    message: "give exactly one of url and path",
  });

// What the agent reads for each refusal, by the engine's code, which a broken answer also takes.
const refusals: Readonly<Record<string, string>> = {
  "image.not_found":
    "There is no image there: the address answered with an error, or no file has that path.",
  "image.too_large": "The image is over 5 MiB, which look_at_image does not read.",
  "image.format": "That is no PNG, JPEG or WebP image, the only kinds look_at_image reads.",
  "image.unreadable": "The image could not be read. Try again, or ask the owner to send it.",
  "image.walled":
    "That file is inside binference's own folder, which is walled off. Never try to reach it another way.",
  "image.not_public":
    "That address is not on the public internet: look_at_image never reaches a local, private or metadata address.",
};

const lookRefusals: Readonly<Record<ImageLookRefusal, string>> = {
  no_model:
    "No model of this agent can see images: the owner sets one in models.imageInput or models.vision. Tell the owner.",
  failed: "The model that looks at images did not answer. Try again later.",
};

const defaultQuestion = "What does it show?";

function readFailed(code: string): ToolOutcome {
  return { text: refusals[code] ?? `look_at_image failed with ${code}.`, isError: true };
}

/**
 * `look_at_image`, a read tool (decision 0385): reads one PNG, JPEG or WebP image of at most 5 MiB
 * from a public address or a file on the engine's machine outside binference's own folder, through
 * the engine's `image/view`, and answers a model's description of it, with the question the agent
 * asked. Every answer is outside content: an image may hold any words.
 */
export function lookAtImageTool({ agent, client }: AgentToolParts): AgentTool {
  return defineTool({
    name: "look_at_image",
    kind: "read",
    outside: true,
    description: agentToolTexts.look_at_image,
    args: lookArgs,
    run: async ({ url, path, question }, { signal, look }) => {
      const place = url === undefined ? { path: path ?? "" } : { url };
      try {
        const image = await readPagedImage<string>({
          part: async (offset) =>
            ok(
              await client.call(
                "image/view",
                { agent, ...place, ...(offset === 0 ? {} : { offset }) },
                { signal },
              ),
            ),
          unreadable: "image.unreadable",
          tooLarge: "image.too_large",
        });
        if (!image.ok) {
          return readFailed(image.error);
        }
        const seen = await look(image.value, question ?? defaultQuestion);
        return seen.ok
          ? { text: seen.value, isError: false }
          : { text: lookRefusals[seen.error], isError: true };
      } catch (error) {
        if (!(error instanceof BinferenceError)) {
          throw error;
        }
        return refusals[error.code] === undefined
          ? failedAnswer("look_at_image", error)
          : readFailed(error.code);
      }
    },
  });
}
