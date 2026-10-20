import type { JsonValue, Result } from "@binference/core";
import { err, ok } from "@binference/core";
import type { LaunchImage } from "../intents/token-launch-quote.js";
import type { HostedLaunch } from "../venues/launch-calls.js";
import { launchImageOf } from "./launch-image.js";
import type { LaunchPathOptions } from "./resolve-launch.js";

/** A launch's picture as the engine read it: its bytes and what the quote keeps of it. */
export interface ReadPicture {
  readonly bytes: Readonly<Uint8Array>;
  readonly image: LaunchImage;
}

/** What an upload gave a launch: its picture, the metadata address and the pin to wait for. */
export interface PictureUpload {
  readonly image: LaunchImage;
  readonly metadataUri: string;
  readonly pin: JsonValue;
}

/**
 * The launch's picture, read once from the upload the request names: only an upload the
 * proposer's own credential made counts (decision 0236), and only a picture of a type and size a
 * launch takes. Anything else is `undefined`.
 */
export async function readOwnPicture(
  options: Pick<LaunchPathOptions, "launch">,
  asked: { readonly upload: string; readonly credential: string | undefined },
  signal: AbortSignal,
): Promise<ReadPicture | undefined> {
  const { images } = options.launch;
  const { upload, credential } = asked;
  const isOwn = credential !== undefined && images?.holderOf(upload) === credential;
  const read = images === undefined || !isOwn ? undefined : await images.read(upload, { signal });
  const image = read?.ok === true ? launchImageOf(read.value) : undefined;
  return read?.ok === true && image !== undefined ? { bytes: read.value, image } : undefined;
}

/**
 * Has the launchpad upload the launch's words and picture and ask for the pin, without waiting
 * for it (decision 0234). A launchpad that cannot is `venue_down`.
 */
export async function uploadPicture(
  options: Pick<LaunchPathOptions, "launch">,
  launch: { readonly hosted: HostedLaunch; readonly picture: ReadPicture },
  signal: AbortSignal,
): Promise<Result<PictureUpload, "venue_down">> {
  const { hosted, picture } = launch;
  const { image } = picture;
  const sent = { contentType: image.contentType, bytes: picture.bytes };
  const pin = await options.launch.host.pin(hosted, sent, { signal });
  return pin.ok
    ? ok({ image, metadataUri: pin.value.metadataUri, pin: pin.value.pin })
    : err(pin.error);
}
