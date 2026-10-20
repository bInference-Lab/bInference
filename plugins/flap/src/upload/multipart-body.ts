import { createHash } from "node:crypto";
import { BinferenceError } from "@binference/plugin-sdk";

/** One part of a `multipart/form-data` body: a text field, or a file with its type and name. */
export type FormPart =
  | { readonly name: string; readonly text: string }
  | {
      readonly name: string;
      readonly file: Readonly<Uint8Array>;
      readonly fileName: string;
      readonly contentType: string;
    };

/** A body ready to send: its bytes and the content type that names its boundary. */
export interface MultipartBody {
  readonly contentType: string;
  readonly bytes: Uint8Array;
}

const encoder = new TextEncoder();

function headOf(part: FormPart): string {
  return "file" in part
    ? `Content-Disposition: form-data; name="${part.name}"; filename="${part.fileName}"\r\nContent-Type: ${part.contentType}\r\n\r\n`
    : `Content-Disposition: form-data; name="${part.name}"\r\n\r\n`;
}

const bytesOf = (part: FormPart): Readonly<Uint8Array> =>
  "file" in part ? part.file : encoder.encode(part.text);

/**
 * Writes a `multipart/form-data` body as RFC 7578 lays it out. Its boundary comes from the SHA-256
 * of the parts, so the same parts always give the same bytes; a part that holds the boundary, which
 * no real file does, throws rather than send a body the server would cut wrong.
 */
export function multipartBody(parts: readonly FormPart[]): MultipartBody {
  const hash = createHash("sha256");
  for (const part of parts) {
    hash.update(bytesOf(part));
  }
  const boundary = `binference-${hash.digest("hex")}`;
  const marker = encoder.encode(boundary);
  if (parts.some((part) => Buffer.from(bytesOf(part)).includes(marker))) {
    throw new BinferenceError({
      code: "flap.bad_upload",
      message: "A part of the upload holds its own boundary.",
    });
  }
  const chunks = parts.flatMap((part) => [
    encoder.encode(`--${boundary}\r\n${headOf(part)}`),
    Uint8Array.from(bytesOf(part)),
    encoder.encode("\r\n"),
  ]);
  const body = Buffer.concat([...chunks, encoder.encode(`--${boundary}--\r\n`)]);
  return {
    contentType: `multipart/form-data; boundary=${boundary}`,
    bytes: new Uint8Array(body),
  };
}
