import type { OwnerImageSource } from "../chat/ports.js";
import type { UploadShelf } from "./upload-shelf.js";

/** Where the engine reads the owner's images from (decision 0227). */
export interface ImageOptions {
  /** The bot's photos by `tg:<file_id>`; without it, none is read. */
  readonly botImages?: OwnerImageSource;
  /**
   * The owner's uploads, which `upload/start` tickets and `POST /upload/:ticket` fills; the
   * composition root gives the server the same shelf. An engine without one makes its own.
   */
  readonly uploads?: UploadShelf;
}
