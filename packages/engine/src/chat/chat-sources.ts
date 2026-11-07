import type { UploadShelf } from "../uploads/upload-shelf.js";
import type { OwnerImageSource, ViewImageSource } from "./ports.js";

/**
 * What the agent's chat reads beyond the stores: the owner's images (decision 0227) and the
 * images the agent views (decision 0385).
 */
export interface ChatSources {
  /** The bot's photos by `tg:<file_id>`; without it, none is read. */
  readonly botImages?: OwnerImageSource;
  /**
   * The owner's uploads, which `upload/start` tickets and `POST /upload/:ticket` fills; the
   * composition root gives the server the same shelf. An engine without one makes its own.
   */
  readonly uploads?: UploadShelf;
  /** The images the agent views (decision 0385); without it, every view is `image.unreadable`. */
  readonly viewImages?: ViewImageSource;
}
