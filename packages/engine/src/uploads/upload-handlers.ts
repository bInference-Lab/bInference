import { ok } from "@binference/core";
import type { EngineHandler } from "../operations/engine-call.js";
import type { UploadShelf } from "./upload-shelf.js";

/** The operation that starts an upload of the owner's image (protocol spec, section 7.9). */
export interface UploadHandlers {
  readonly "upload/start": EngineHandler<"upload/start">;
}

/**
 * Creates the handler of `upload/start`: a single-use ticket for one image, valid 2 minutes, as
 * the path of `POST /upload/:ticket` on the address the client reached the engine at.
 */
export function createUploadHandlers(shelf: Pick<UploadShelf, "ticket">): UploadHandlers {
  return {
    async "upload/start"(call) {
      const { ticket, expiresAt } = shelf.ticket(call.args);
      return Promise.resolve(ok({ url: `/upload/${ticket}`, expiresAt }));
    },
  };
}
