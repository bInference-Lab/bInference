import type { ProtocolClient } from "@binference/client";
import type { ImageContentType } from "@binference/protocol";
import type { Fetcher } from "../app/console-browser";
import { readUploadAnswer } from "./upload-answer.schema";

/** An image to upload: its bytes as the browser holds them, and its checked type. */
export interface ImageUpload {
  readonly body: Blob;
  readonly contentType: ImageContentType;
}

/**
 * Uploads one image the way the engine takes it (decisions 0227 and 0229): `upload/start` names
 * its type and size and gives a one-time path, valid 2 minutes, then the raw bytes go to that path
 * on the page's own origin, the public address in the Mini App. Resolves with the upload id;
 * rejects with the engine's error code, such as `image.too_large`.
 */
export async function uploadImage(
  link: { readonly client: ProtocolClient; readonly fetch: Fetcher },
  image: ImageUpload,
  signal: AbortSignal,
): Promise<string> {
  const { contentType, body } = image;
  const started = await link.client.call(
    "upload/start",
    { contentType, bytes: body.size },
    { signal },
  );
  const answer = await link.fetch(started.url, {
    method: "POST",
    headers: { "content-type": contentType },
    body,
    signal,
  });
  const read = readUploadAnswer(answer.status, await answer.text());
  if (!read.ok) {
    throw Object.assign(new Error("The engine refused the image."), { code: read.code });
  }
  return read.upload;
}
