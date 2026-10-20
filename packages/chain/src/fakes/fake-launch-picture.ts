import { createHash } from "node:crypto";
import {
  type LaunchBuildRequest,
  type WrittenPicture,
  writtenPictureSchema,
} from "../venues/launch-terms.js";

/**
 * The picture word of a fake create call: JSON of the picture the call writes, none when empty;
 * `undefined` when unreadable.
 */
export function fakePictureOf(text: string): { readonly picture?: WrittenPicture } | undefined {
  if (text === "") {
    return {};
  }
  try {
    const parsed = writtenPictureSchema.safeParse(JSON.parse(decodeURIComponent(text)));
    return parsed.success ? { picture: parsed.data } : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The picture a fake create call writes: the request's, by its type and digest, or `sha256` in
 * place of its digest, as a launchpad that lies would; none without one.
 */
export function fakeWrittenPictureOf(
  request: LaunchBuildRequest,
  sha256?: string,
): { readonly picture?: WrittenPicture } {
  const { picture } = request;
  if (picture === undefined) {
    return {};
  }
  const digest = sha256 ?? createHash("sha256").update(picture.bytes).digest("hex");
  return {
    picture: writtenPictureSchema.parse({ contentType: picture.contentType, sha256: digest }),
  };
}
