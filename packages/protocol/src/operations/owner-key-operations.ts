import { z } from "zod";
import { optionalOwnerKeyCodeSchema, ownerKeyCodeSchema } from "../values/owner-key-code.schema.js";
import type { Operation } from "./operation.schema.js";
import { type OperationName, operationNames, operations } from "./operations.js";

/**
 * Whether an operation's args carry the owner key code: a field parsed by the owner key's own
 * schema, whatever its name. Such an operation is an owner-key operation, and the server accepts
 * it over the IPC transport only (protocol spec, section 12), whatever its row says.
 */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- zod schemas are mutable
export function takesOwnerKey(operation: Pick<Operation, "args">): boolean {
  const { args } = operation;
  return args instanceof z.ZodObject && Object.values(args.shape).includes(ownerKeyCodeSchema);
}

/**
 * The names of an operation's args that hold the owner key code, required or optional, found by
 * the owner key's own schema. The server keeps none of them, not even in a hash.
 */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- zod schemas are mutable
export function ownerKeyFields(operation: Pick<Operation, "args">): readonly string[] {
  const { args } = operation;
  const names: string[] = [];
  if (!(args instanceof z.ZodObject)) {
    return names;
  }
  for (const [name, field] of Object.entries(args.shape)) {
    if (field === ownerKeyCodeSchema || field === optionalOwnerKeyCodeSchema) {
      names.push(name);
    }
  }
  return names;
}

/** Every owner-key operation of the protocol, in the table's order. */
export const ownerKeyOperations: readonly OperationName[] = operationNames.filter((name) =>
  takesOwnerKey(operations[name]),
);
