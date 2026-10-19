import type { UploadShelf } from "../uploads/upload-shelf.js";

/**
 * What a token launch reads its picture through: the owner's uploads, by the upload id
 * `POST /upload/:ticket` answered (protocol spec, section 7.9; decision 0234), and the credential
 * that held each upload's ticket, since a launch reads only a picture its proposer uploaded
 * (decision 0236). An upload the source does not hold, or no longer holds, is `unreadable` and
 * has no holder. Adapters: the engine's upload shelf.
 */
export type LaunchImageSource = Pick<UploadShelf, "read" | "holderOf">;
