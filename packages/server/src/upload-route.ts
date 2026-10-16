import { Buffer } from "node:buffer";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { UploadRefusal, UploadShelf } from "@binference/engine/chat";
import { maxImageBytes, type ProtocolErrorCode } from "@binference/protocol";
import { resourceHeaders } from "./security-headers.js";

/** The path every upload goes to, its single-use ticket after it. */
export const uploadPath = "/upload/";

/** What `POST /upload/:ticket` checks and keeps through. */
export interface UploadRouteContext {
  readonly uploads: Pick<UploadShelf, "receive">;
  /** Whether a browser's `Origin` may upload; a request with none is not a browser's. */
  readonly isAllowedOrigin: (origin: string | undefined) => boolean;
}

const jsonHeaders = {
  ...resourceHeaders,
  "cache-control": "no-store",
  "content-type": "application/json",
};

type RouteRefusal = UploadRefusal | "origin";

const refusals: Readonly<
  Record<
    RouteRefusal,
    { readonly status: number; readonly code: ProtocolErrorCode; readonly message: string }
  >
> = {
  ticket: {
    status: 404,
    code: "image.not_found",
    message: "The upload ticket is unknown, used or expired. Start the upload again.",
  },
  too_large: { status: 413, code: "image.too_large", message: "The image is over 5 MiB." },
  length: { status: 400, code: "protocol.bad_args", message: "The body is not the size planned." },
  format: { status: 415, code: "image.format", message: "The body is not the image type planned." },
  origin: { status: 403, code: "auth.origin", message: "This origin may not upload." },
};

function refuse(response: ServerResponse, refusal: RouteRefusal): void {
  const { status, code, message } = refusals[refusal];
  response.writeHead(status, jsonHeaders).end(JSON.stringify({ error: { code, message } }));
}

// The body's bytes, or `undefined` once it passes 5 MiB; the size is checked as pieces arrive.
async function readBody(request: IncomingMessage): Promise<Uint8Array | undefined> {
  const declared = Number(request.headers["content-length"] ?? "0");
  if (Number.isFinite(declared) && declared > maxImageBytes) {
    return undefined;
  }
  const pieces: Buffer[] = [];
  let size = 0;
  for await (const piece of request) {
    const bytes = Buffer.isBuffer(piece) ? piece : Buffer.from(String(piece));
    size += bytes.byteLength;
    if (size > maxImageBytes) {
      return undefined;
    }
    pieces.push(bytes);
  }
  return Buffer.concat(pieces);
}

async function upload(
  request: IncomingMessage,
  response: ServerResponse,
  context: UploadRouteContext & { readonly ticket: string },
): Promise<void> {
  const { origin } = request.headers;
  if (origin !== undefined && !context.isAllowedOrigin(origin)) {
    refuse(response, "origin");
    return;
  }
  const body = await readBody(request);
  if (body === undefined) {
    response.setHeader("connection", "close");
    refuse(response, "too_large");
    return;
  }
  const kept = context.uploads.receive(context.ticket, body);
  if (!kept.ok) {
    refuse(response, kept.error);
    return;
  }
  response.writeHead(201, jsonHeaders).end(JSON.stringify({ upload: kept.value }));
}

/**
 * Answers `POST /upload/:ticket` (protocol spec, section 3; decision 0227): one image of at most
 * 5 MiB, as the ticket of `upload/start` planned it, from no browser or an allowed one. It answers
 * 201 `{ upload }`, or a refusal `{ error: { code, message } }`: 404 `image.not_found` for a
 * ticket that is unknown, used or expired, 413 `image.too_large`, 400 `protocol.bad_args` for a
 * body of another size than planned, 415 `image.format`, 403 `auth.origin`. Another method is 405.
 * The body is never logged.
 */
export function answerUpload(
  request: IncomingMessage,
  response: ServerResponse,
  context: UploadRouteContext & { readonly path: string },
): void {
  if (request.method !== "POST") {
    response.writeHead(405, { ...jsonHeaders, allow: "POST" }).end();
    return;
  }
  const ticket = context.path.slice(uploadPath.length);
  upload(request, response, { ...context, ticket }).catch(() => {
    if (!response.headersSent) {
      response.writeHead(500, jsonHeaders);
    }
    response.end();
  });
}
