import { BinferenceError, err, maxUrlChars, ok, type Result } from "@binference/core";
import { imageTypeOf, maxImageBytes, maxImagesPerMessage } from "@binference/protocol";
import { z } from "zod";
import { type PagedImage, readPagedImage } from "../images/paged-image.js";
import type { ImageLookRefusal, ToolOutcome, ToolRunContext } from "../loop/turn-records.js";
import { agentToolTexts } from "./agent-tool-texts.js";
import { type AgentTool, defineTool } from "./define-tool.js";
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

// What the agent reads for each refusal, by the engine's code, which a broken answer also takes.
const refusals: Readonly<Record<string, string>> = {
  "image.not_found":
    "There is no image there: the address answered with an error, or no file has that path.",
  "image.too_large": "The image is over 5 MiB, which look_at_image does not read.",
  "image.format": "That is no PNG, JPEG or WebP image, the only kinds look_at_image reads.",
  "image.unreadable": "The image could not be read. Try again, or ask the owner to send it.",
  "image.walled":
    "That file is inside binference's own folder, which is walled off. Never try to reach it another way.",
  "image.outside_workspace":
    "The owner keeps your files inside your workspace (files.workspaceOnly), so that file is refused.",
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

/** Where an image to look at is: a public address, a file on the engine's machine, or its bytes. */
export type ImagePlace =
  | { readonly url: string }
  | { readonly path: string }
  | { readonly data: string };

// An address as the agent may write it: a `data:` URL holds the image itself, a `file://` URL and
// a path written with a leading `@` name a file.
function placeOf(written: { readonly url?: string; readonly path?: string }): ImagePlace {
  const { url, path } = written;
  if (url?.startsWith("data:") === true) {
    return { data: url };
  }
  if (url?.startsWith("file://") === true) {
    return { path: decodeURIComponent(new URL(url).pathname) };
  }
  return url === undefined ? { path: (path ?? "").replace(/^@/u, "") } : { url };
}

// An image written inside a `data:` URL, as `image/view` would answer it.
function dataImage(url: string): Result<PagedImage, string> {
  const base64 = /^data:image\/[a-z]+;base64,([A-Za-z0-9+/=]+)$/u.exec(url)?.[1];
  if (base64 === undefined) {
    return err("image.unreadable");
  }
  const bytes = Buffer.from(base64, "base64");
  const contentType = imageTypeOf(bytes);
  if (bytes.byteLength > maxImageBytes) {
    return err("image.too_large");
  }
  return contentType === undefined
    ? err("image.format")
    : ok({ contentType, data: base64, bytes: bytes.byteLength });
}

async function readOne(
  { agent, client }: Pick<AgentToolParts, "agent" | "client">,
  place: ImagePlace,
  signal: AbortSignal,
): Promise<Result<PagedImage, string>> {
  if ("data" in place) {
    return dataImage(place.data);
  }
  return readPagedImage<string>({
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
}

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
    const images: PagedImage[] = [];
    for (const place of places) {
      // oxlint-disable-next-line eslint/no-await-in-loop -- one image in memory at a time, in order
      const image = await readOne(parts, place, signal);
      if (!image.ok) {
        return readFailed(image.error);
      }
      images.push(image.value);
    }
    const seen = await look(images, question);
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
}

// Every place a call names: its address, its path, then its paths.
function placesOf(args: LookAtImageArgs): readonly ImagePlace[] {
  return [
    ...(args.url === undefined ? [] : [placeOf({ url: args.url })]),
    ...(args.path === undefined ? [] : [placeOf({ path: args.path })]),
    ...(args.paths ?? []).map((path) => placeOf({ path })),
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
