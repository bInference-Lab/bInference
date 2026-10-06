import { z } from "zod";
import { type OperationName, operationNames, operations } from "../operations/operations.js";
import type { EngineDescription, OperationDescription } from "./engine-description.schema.js";
import { wireJsonOptions } from "./wire-json-schema.js";

function describeOperation(name: OperationName): OperationDescription {
  const operation = operations[name];
  return {
    name,
    scope: operation.scope,
    ...(operation.scopeCase === undefined ? {} : { scopeCase: operation.scopeCase }),
    kind: operation.kind,
    idempotency: operation.idempotency,
    transport: operation.transport,
    answeredBy: operation.answeredBy,
    since: operation.since,
    args: z.toJSONSchema(operation.args, wireJsonOptions),
    result: z.toJSONSchema(operation.result, wireJsonOptions),
  };
}

/**
 * Describes every operation as `engine/describe` answers: its scope, flags, `since`, and the JSON
 * Schemas of its args and result. The MCP server takes each tool's input schema from here.
 */
export function describeOperations(): EngineDescription {
  return { operations: operationNames.map(describeOperation) };
}
