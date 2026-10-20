import {
  accountRefParts,
  BinferenceError,
  type JsonValue,
  type LaunchPin,
  type LaunchPinRequest,
  type PinStatus,
} from "@binference/plugin-sdk";
import { z } from "zod";
import {
  type FlapApiFailure,
  type FlapMetadata,
  readPinStatus,
  uploadMetadata,
} from "../upload/flap-api.js";
import type { LaunchParts } from "./launch-parts.js";
import { placeOf } from "./launch-steps.js";

const extensions: Readonly<Record<string, string>> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

/** The handle of a Flap pin the host keeps: the metadata's CID. */
const pinHandleSchema = z.strictObject({ cid: z.string().min(1).max(120) });

// A failure of Flap's API as the fault the launcher throws: `flap.api_<failure>`.
function apiFault(action: string, failure: FlapApiFailure): BinferenceError {
  return new BinferenceError({
    code: `flap.api_${failure}`,
    message: `Flap's API could not ${action}: ${failure.replace("_", " ")}.`,
    retryable: failure === "rate_limited" || failure === "unavailable",
  });
}

// The metadata's words as Flap's `MetadataInput` takes them; a link left out is null.
function metadataOf(request: LaunchPinRequest): FlapMetadata {
  const { links } = request;
  return {
    description: request.description ?? "",
    website: links?.website ?? null,
    twitter: links?.x ?? null,
    telegram: links?.telegram ?? null,
    creator: accountRefParts(request.wallet).address,
  };
}

/**
 * Uploads a launch's picture and words through Flap's upload API, which stores them on IPFS and
 * pins them on Flap's storage, and answers without waiting for the pin. The create call names the
 * metadata's CID; the handle keeps it for {@link pinStatusOf}. Nothing reads a gateway. A launch on
 * a chain or pair Flap does not launch against, a picture of another type, or an upload Flap's API
 * refuses or fails throws (`flap.api_<failure>`).
 */
export async function pinLaunch(
  request: LaunchPinRequest,
  parts: LaunchParts,
  signal: AbortSignal,
): Promise<LaunchPin> {
  signal.throwIfAborted();
  const extension = extensions[request.image.contentType];
  if (placeOf(request, parts) === undefined || extension === undefined) {
    throw new BinferenceError({
      code: "flap.bad_launch",
      message: "Flap launches here only with a PNG, JPEG or WebP picture, on its chains and pairs.",
    });
  }
  const metadata = metadataOf(request);
  const image = { ...request.image, fileName: `image.${extension}` };
  const cid = await uploadMetadata(parts.http, { image, metadata }, signal);
  if (!cid.ok) {
    throw apiFault("upload the launch's picture and words", cid.error);
  }
  return { metadataUri: cid.value, pin: { cid: cid.value } };
}

/**
 * Where Flap's pin of an upload stands, from its pin status API alone, never a gateway read. A
 * handle this venue did not give, or a status read Flap's API refuses or fails, throws.
 */
export async function pinStatusOf(
  pin: JsonValue,
  parts: LaunchParts,
  signal: AbortSignal,
): Promise<PinStatus> {
  signal.throwIfAborted();
  const handle = pinHandleSchema.safeParse(pin);
  if (!handle.success) {
    throw new BinferenceError({ code: "flap.bad_pin", message: "The pin is none Flap gave." });
  }
  const status = await readPinStatus(parts.http, handle.data.cid, signal);
  if (!status.ok) {
    throw apiFault("read the pin's status", status.error);
  }
  return status.value;
}
