import { err, ok, type Result } from "@binference/core";
import { z } from "zod";
import { checkProtocolVersion } from "../versions/protocol-version.js";
import { type ByeFrame, byeFrameSchema } from "./bye-frame.schema.js";
import { type CallFrame, callFrameSchema } from "./call-frame.schema.js";
import { type ChallengeFrame, challengeFrameSchema } from "./challenge-frame.schema.js";
import { type FailFrame, failFrameSchema } from "./fail-frame.schema.js";
import { type OpenFrame, openFrameSchema } from "./open-frame.schema.js";
import { type ProveFrame, proveFrameSchema } from "./prove-frame.schema.js";
import { type PushFrame, pushFrameSchema } from "./push-frame.schema.js";
import { type ReadyFrame, readyFrameSchema } from "./ready-frame.schema.js";
import { type ReplyFrame, replyFrameSchema } from "./reply-frame.schema.js";

/** A frame a client sends to the engine. */
export type ClientFrame = OpenFrame | ProveFrame | CallFrame;

/** A frame the engine sends to a client. */
export type EngineFrame =
  | ChallengeFrame
  | ReadyFrame
  | ReplyFrame
  | FailFrame
  | PushFrame
  | ByeFrame;

/** Why the engine refuses a client's frame: it is malformed, or it opens an unserved version. */
export type ClientFrameProblem = "protocol.bad_frame" | "protocol.version";

/** Parses any frame a client sends. Fields a frame does not define are dropped. */
export const clientFrameSchema: z.ZodType<ClientFrame> = z.union([
  openFrameSchema,
  proveFrameSchema,
  callFrameSchema,
]);

/** Parses any frame the engine sends. Fields a frame does not define are dropped. */
export const engineFrameSchema: z.ZodType<EngineFrame> = z.union([
  challengeFrameSchema,
  readyFrameSchema,
  replyFrameSchema,
  failFrameSchema,
  pushFrameSchema,
  byeFrameSchema,
]);

// Only `t` and `v` are read, so an `open` of another version is refused for its version even
// when the rest of its shape is new.
const openVersionSchema = z.object({ t: z.literal("open"), v: z.int() });

function parseJson(text: string): Result<unknown, "protocol.bad_frame"> {
  try {
    const value: unknown = JSON.parse(text);
    return ok(value);
  } catch {
    return err("protocol.bad_frame");
  }
}

/**
 * Decodes one WebSocket text message from a client. Text that is not JSON or not a client frame
 * is `protocol.bad_frame`; an `open` that names a version the engine does not serve is
 * `protocol.version`.
 */
export function decodeClientFrame(text: string): Result<ClientFrame, ClientFrameProblem> {
  const json = parseJson(text);
  if (!json.ok) {
    return json;
  }
  const open = openVersionSchema.safeParse(json.value);
  if (open.success) {
    const version = checkProtocolVersion(open.data.v);
    if (!version.ok) {
      return version;
    }
  }
  const frame = clientFrameSchema.safeParse(json.value);
  return frame.success ? ok(frame.data) : err("protocol.bad_frame");
}

/**
 * Decodes one WebSocket text message from the engine. Text that is not JSON or not an engine
 * frame is `protocol.bad_frame`.
 */
export function decodeEngineFrame(text: string): Result<EngineFrame, "protocol.bad_frame"> {
  const json = parseJson(text);
  if (!json.ok) {
    return json;
  }
  const frame = engineFrameSchema.safeParse(json.value);
  return frame.success ? ok(frame.data) : err("protocol.bad_frame");
}
