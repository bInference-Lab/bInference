import type { OwnerImageSource } from "../chat/ports.js";

/**
 * What a token launch reads its picture through: the owner's images, by the upload id
 * `POST /upload/:ticket` answered (protocol spec, section 7.9; decision 0234). An upload the
 * source does not hold, or no longer holds, is `unreadable`. Adapters: the engine's store of
 * uploads.
 */
export type LaunchImageSource = Pick<OwnerImageSource, "read">;
