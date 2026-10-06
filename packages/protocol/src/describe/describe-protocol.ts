import { z } from "zod";
import { protocolErrorCodes } from "../errors/protocol-error-codes.js";
import { byeFrameSchema } from "../frames/bye-frame.schema.js";
import {
  callFrameSchema,
  callIdSchema,
  idempotencyKeySchema,
} from "../frames/call-frame.schema.js";
import { challengeFrameSchema } from "../frames/challenge-frame.schema.js";
import { failFrameSchema } from "../frames/fail-frame.schema.js";
import { openFrameSchema } from "../frames/open-frame.schema.js";
import { proveFrameSchema } from "../frames/prove-frame.schema.js";
import { pushFrameSchema } from "../frames/push-frame.schema.js";
import { readyFrameSchema } from "../frames/ready-frame.schema.js";
import { replyFrameSchema } from "../frames/reply-frame.schema.js";
import { idPrefixes } from "../ids/id-prefixes.js";
import { type OperationName, operationNames, operations } from "../operations/operations.js";
import { protocolVersion } from "../versions/protocol-version.js";
import { wireJsonOptions } from "./wire-json-schema.js";

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

// The call frame of one operation carries its access rules, so a changed scope, kind or
// transport shows in the compatibility check like a changed field.
function callSchemaOf(name: OperationName): z.ZodType {
  const operation = operations[name];
  return z
    .object({
      t: z.literal("call"),
      id: callIdSchema,
      op: z.literal(name),
      args: operation.args,
      key:
        operation.idempotency === "key"
          ? idempotencyKeySchema
          : idempotencyKeySchema.exactOptional(),
    })
    .meta({
      scope: operation.scope,
      ...(operation.scopeCase === undefined ? {} : { scopeCase: operation.scopeCase }),
      kind: operation.kind,
      transport: operation.transport,
      answeredBy: operation.answeredBy,
      since: operation.since,
    });
}

function replySchemaOf(name: OperationName): z.ZodType {
  return z.object({ t: z.literal("reply"), id: callIdSchema, result: operations[name].result });
}

function operationSchemas(): readonly (readonly [string, z.ZodType])[] {
  return operationNames.flatMap((name) => [
    [`call/${name}`, callSchemaOf(name)] as const,
    [`reply/${name}`, replySchemaOf(name)] as const,
  ]);
}

/** The protocol of one version as JSON Schemas, by name, such as `frame/open`. */
export interface ProtocolDescription {
  readonly version: number;
  readonly schemas: Readonly<Record<string, z.core.JSONSchema.BaseSchema>>;
}

/**
 * Describes the protocol as JSON Schemas of what travels on the wire, for clients in other
 * languages, the docs and the compatibility check: every frame, the error codes, the id prefixes,
 * and the call and reply of every operation, the call carrying the operation's scope, kind and
 * `since`. Throws when a schema has no JSON Schema form.
 */
export function describeProtocol(): ProtocolDescription {
  const schemas: Record<string, z.core.JSONSchema.BaseSchema> = {};
  for (const [name, schema] of [...Object.entries(describedSchemas), ...operationSchemas()]) {
    schemas[name] = z.toJSONSchema(schema, wireJsonOptions);
  }
  return { version: protocolVersion, schemas };
}
