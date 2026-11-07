import { err, ok, type Result } from "@binference/core";
import { imageTypeOf, maxImageBytes } from "@binference/protocol";
import { type PagedImage, readPagedImage } from "../images/paged-image.js";
import type { ToolOutcome } from "../loop/turn-records.js";
import type { AgentToolParts } from "./tool-client.js";

// What the agent reads for each refusal, by the engine's code, which a broken answer also takes.
/** What the agent reads for each refusal of an image read, by the engine's code. */
export const imageRefusals: Readonly<Record<string, string>> = {
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

/** The sentence of an image read's refusal, as a failed tool's answer. */
export function imageReadFailed(code: string): ToolOutcome {
  return { text: imageRefusals[code] ?? `look_at_image failed with ${code}.`, isError: true };
}

/** Where an image to look at is: a public address, a file on the engine's machine, or its bytes. */
export type ImagePlace =
  | { readonly url: string }
  | { readonly path: string }
  | { readonly data: string };

// An address as the agent may write it: a `data:` URL holds the image itself, a `file://` URL and
// a path written with a leading `@` name a file.
export function imagePlaceOf(written: {
  readonly url?: string;
  readonly path?: string;
}): ImagePlace {
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
 * The place an image name stands for: a public address, a `data:` address or a `file://` address
 * as written, anything else a file path.
 */
export function placeOfName(name: string): ImagePlace {
  return /^(?:https?:|data:|file:)/iu.test(name)
    ? imagePlaceOf({ url: name })
    : imagePlaceOf({ path: name });
}

/**
 * Reads images in order, one in memory at a time: through the engine's `image/view`, or from their
 * `data:` addresses. Answers the engine's refusal code of the first that cannot be read.
 */
export async function readImages(
  parts: Pick<AgentToolParts, "agent" | "client">,
  places: readonly ImagePlace[],
  signal: AbortSignal,
): Promise<Result<readonly PagedImage[], string>> {
  const images: PagedImage[] = [];
  for (const place of places) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- one image in memory at a time, in order
    const image = await readOne(parts, place, signal);
    if (!image.ok) {
      return image;
    }
    images.push(image.value);
  }
  return ok(images);
}
