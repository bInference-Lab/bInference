import { err, type Id, jsonValueSchema, ok, type Result } from "@binference/core";
import { fileLimits, type ProtocolErrorCode, type ResultOf } from "@binference/protocol";
import { type EngineFiles, fileRefusalCodes } from "../files/file-handlers.js";
import type { EngineHandler } from "../operations/engine-call.js";
import { type ChatRelayOptions, chatTopic } from "./chat-relay-parts.js";
import { keepBounded } from "./keep-bounded.js";

/** A file the agent sent, as `file/send` answers it. */
type SentFileView = ResultOf<"file/send">["files"][number];

/** The operations of the files the agent sends the owner (decision 0400). */
export interface SentFileHandlers {
  readonly "file/send": EngineHandler<"file/send">;
  readonly "file/fetch": EngineHandler<"file/fetch">;
}

/** What the sent files are read and told through. */
export type SentFileOptions = Pick<ChatRelayOptions, "turns" | "clock" | "publish" | "random"> & {
  /** The agent's files, read as the file tools read them; without them every send is refused. */
  readonly sentFiles?: EngineFiles;
};

/** A sent file the engine keeps an id for. */
interface KeptFile {
  readonly agent: Id<"agt">;
  readonly view: SentFileView;
}

/** A sent file's bytes, held while a surface reads it in parts. */
interface HeldBytes {
  readonly bytes: Uint8Array;
  readonly untilMs: number;
}

// How many sent files keep an id, how many are held in memory at once and for how long.
const mostKept = 64;
const mostHeld = 2;
const heldMs = 120_000;

// A path's last part, as a surface names the file.
function nameOf(path: string): string {
  const name = path.split(/[\\/]/u).at(-1) ?? "";
  return name === "" ? "file" : name.slice(0, 255);
}

async function readFile(
  files: EngineFiles,
  path: string,
  signal: AbortSignal,
): Promise<Result<{ readonly path: string; readonly bytes: Uint8Array }, ProtocolErrorCode>> {
  const call = { signal, workspaceOnly: files.settings().workspaceOnly };
  const read = await files.files.read(path, { ...call, maxBytes: fileLimits.maxSentFileBytes });
  return read.ok ? ok(read.value) : err(fileRefusalCodes[read.error]);
}

interface SentState {
  readonly kept: Map<string, KeptFile>;
  readonly held: Map<string, HeldBytes>;
}

function sendHandler(options: SentFileOptions, state: SentState): EngineHandler<"file/send"> {
  return async (call) => {
    if (!options.turns.isRuntime(call.caller.credential)) {
      return err("auth.scope");
    }
    const files = options.sentFiles;
    if (files === undefined) {
      return err("file.unreadable");
    }
    const { agent, turn, paths, caption } = call.args;
    const views: SentFileView[] = [];
    for (const path of paths) {
      // oxlint-disable-next-line eslint/no-await-in-loop -- each file is read in turn, and the first refusal stops the rest
      const read = await readFile(files, path, call.signal);
      if (!read.ok) {
        return read;
      }
      const file = Buffer.from(options.random.bytes(8)).toString("hex");
      const { bytes } = read.value;
      views.push({
        file,
        name: nameOf(read.value.path),
        bytes: bytes.byteLength,
        path: read.value.path,
      });
    }
    for (const view of views) {
      keepBounded(state.kept, [view.file, { agent, view }], mostKept);
    }
    const data = jsonValueSchema.parse({ agent, turn, caption, files: views });
    options.publish({ topic: chatTopic(agent), kind: "chat/files", data });
    return ok({ files: views });
  };
}

// The sent file's bytes: held from an earlier part, or read again where it is.
async function bytesOf(
  { options, state }: { readonly options: SentFileOptions; readonly state: SentState },
  kept: KeptFile,
  signal: AbortSignal,
): Promise<Result<Uint8Array, ProtocolErrorCode>> {
  const nowMs = options.clock.now();
  const held = state.held.get(kept.view.file);
  if (held !== undefined && held.untilMs > nowMs) {
    return ok(held.bytes);
  }
  const files = options.sentFiles;
  if (files === undefined) {
    return err("file.not_found");
  }
  const read = await readFile(files, kept.view.path, signal);
  if (read.ok) {
    const entry = { bytes: read.value.bytes, untilMs: nowMs + heldMs };
    keepBounded(state.held, [kept.view.file, entry], mostHeld);
  }
  return read.ok ? ok(read.value.bytes) : read;
}

function fetchHandler(options: SentFileOptions, state: SentState): EngineHandler<"file/fetch"> {
  return async (call) => {
    const { agent, file, offset = 0 } = call.args;
    const kept = state.kept.get(file);
    if (kept?.agent !== agent) {
      return err("file.not_found");
    }
    const read = await bytesOf({ options, state }, kept, call.signal);
    if (!read.ok) {
      return read;
    }
    const bytes = read.value;
    if (offset > 0 && offset >= bytes.byteLength) {
      return err("protocol.bad_args");
    }
    const end = Math.min(bytes.byteLength, offset + fileLimits.sentFilePartBytes);
    if (end >= bytes.byteLength) {
      state.held.delete(file);
    }
    const data = Buffer.from(bytes.subarray(offset, end)).toString("base64");
    const next = end < bytes.byteLength ? { next: end } : {};
    return ok({ name: kept.view.name, bytes: bytes.byteLength, offset, data, ...next });
  };
}

/**
 * Creates the operations of the files the agent sends the owner (decision 0400). `file/send`
 * answers only the runtime the engine runs now: it reads each file as `file/read` reads a path,
 * so binference's own folder stays walled off and `files.workspaceOnly` holds, at most 20 MiB,
 * every file before any is sent, and pushes them as `chat/files`. `file/fetch` answers a sent
 * file's parts by its id to a surface, read again where it is and held in memory for 2 minutes
 * while its parts are read, at most two files at once. The ids of the last 64 are kept.
 */
export function createSentFileHandlers(options: SentFileOptions): SentFileHandlers {
  const state: SentState = { kept: new Map(), held: new Map() };
  return {
    "file/send": sendHandler(options, state),
    "file/fetch": fetchHandler(options, state),
  };
}
