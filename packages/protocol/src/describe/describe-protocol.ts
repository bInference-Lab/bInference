import { z } from "zod";
import { protocolErrorCodes } from "../errors/protocol-error-codes.js";
import { byeFrameSchema } from "../frames/bye-frame.schema.js";
import { callFrameSchema } from "../frames/call-frame.schema.js";
import { challengeFrameSchema } from "../frames/challenge-frame.schema.js";
import { failFrameSchema } from "../frames/fail-frame.schema.js";
import { openFrameSchema } from "../frames/open-frame.schema.js";
import { proveFrameSchema } from "../frames/prove-frame.schema.js";
import { pushFrameSchema } from "../frames/push-frame.schema.js";
import { readyFrameSchema } from "../frames/ready-frame.schema.js";
import { replyFrameSchema } from "../frames/reply-frame.schema.js";
import { idPrefixes } from "../ids/id-prefixes.js";
import { protocolVersion } from "../versions/protocol-version.js";

const describedSchemas: Readonly<Record<string, z.ZodType>> = {
  "frame/open": openFrameSchema,
  "frame/challenge": challengeFrameSchema,
  "frame/prove": proveFrameSchema,
  "frame/ready": readyFrameSchema,
  "frame/call": callFrameSchema,
  "frame/reply": replyFrameSchema,
  "frame/fail": failFrameSchema,
  "frame/push": pushFrameSchema,
  "frame/bye": byeFrameSchema,
  "error/codes": z.enum(protocolErrorCodes),
  "id/prefixes": z.enum(idPrefixes),
};

/** The protocol of one version as JSON Schemas, by name, such as `frame/open`. */
export interface ProtocolDescription {
  readonly version: number;
  readonly schemas: Readonly<Record<string, z.core.JSONSchema.BaseSchema>>;
}

/**
 * Describes the protocol as JSON Schemas of what travels on the wire, for clients in other
 * languages, the docs and the compatibility check. Throws when a schema has no JSON Schema form.
 */
export function describeProtocol(): ProtocolDescription {
  const schemas: Record<string, z.core.JSONSchema.BaseSchema> = {};
  for (const [name, schema] of Object.entries(describedSchemas)) {
    schemas[name] = z.toJSONSchema(schema, { io: "input", unrepresentable: "throw" });
  }
  return { version: protocolVersion, schemas };
}
