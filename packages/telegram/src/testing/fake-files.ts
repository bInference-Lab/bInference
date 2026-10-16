import { err, type JsonValue, ok, type Result } from "@binference/core";
import { z } from "zod";

/** A file the synthetic Bot API holds for `getFile`. */
export interface FakeFile {
  readonly bytes: Uint8Array;
  /** The size `getFile` reports; the bytes' own length when absent, none when `null`. */
  readonly reportedSize?: number | null;
}

/** The files of a synthetic Bot API: `getFile` and the downloads of `/file/bot<token>/<path>`. */
export interface FakeFiles {
  /** Holds a file under its id, as Telegram does for a photo or document the bot received. */
  add(fileId: string, file: FakeFile): void;
  /** Answers `getFile` for a JSON body. */
  getFile(body: string): Result<JsonValue, string>;
  /** Answers a download of a path `getFile` gave, or 404 for any other. */
  download(path: string): Response;
  /** How many downloads came in. */
  downloads(): number;
}

// The Bot API's download limit: it refuses `getFile` for a larger file.
const maxDownloadBytes = 20 * 1024 * 1024;
const getFileSchema = z.looseObject({ file_id: z.string() });

/** Creates the files of a synthetic Bot API, empty. */
export function createFakeFiles(): FakeFiles {
  const files = new Map<string, FakeFile & { readonly path: string }>();
  const byPath = new Map<string, Uint8Array>();
  let downloads = 0;
  return {
    add(fileId, file) {
      const path = `photos/file_${String(files.size)}.jpg`;
      files.set(fileId, { ...file, path });
      byPath.set(path, file.bytes);
    },
    getFile(body) {
      const fileId = getFileSchema.parse(JSON.parse(body)).file_id;
      const file = files.get(fileId);
      if (file === undefined) {
        return err("Bad Request: invalid file_id");
      }
      if (file.bytes.byteLength > maxDownloadBytes) {
        return err("Bad Request: file is too big");
      }
      const size = file.reportedSize === undefined ? file.bytes.byteLength : file.reportedSize;
      return ok({
        file_id: fileId,
        file_unique_id: `unique-${fileId.slice(0, 8)}`,
        ...(size === null ? {} : { file_size: size }),
        file_path: file.path,
      });
    },
    download(path) {
      downloads += 1;
      const bytes = byPath.get(path);
      return bytes === undefined ? new Response("", { status: 404 }) : new Response(bytes);
    },
    downloads: () => downloads,
  };
}
