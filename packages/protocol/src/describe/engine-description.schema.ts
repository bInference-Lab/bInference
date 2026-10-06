import { z } from "zod";
import { type Scope, scopeSchema } from "../auth/scopes.js";
import {
  type IdempotencyRule,
  idempotencyRuleSchema,
  type OperationKind,
  operationKindSchema,
  type OperationResponder,
  operationResponderSchema,
  type OperationTransport,
  operationTransportSchema,
  type ScopeCase,
  scopeCaseSchema,
} from "../operations/operation.schema.js";
import { releaseVersionSchema } from "../values/release-version.schema.js";

/** A JSON Schema, as `z.toJSONSchema` writes it. */
export type JsonSchema = Readonly<Record<string, unknown>>;

/** One operation as `engine/describe` lists it, with the JSON Schemas of its args and result. */
export interface OperationDescription {
  readonly name: string;
  readonly scope: Scope;
  readonly scopeCase?: ScopeCase;
  readonly kind: OperationKind;
  readonly idempotency: IdempotencyRule;
  readonly transport: OperationTransport;
  readonly answeredBy: OperationResponder;
  readonly since: string;
  readonly args: JsonSchema;
  readonly result: JsonSchema;
}

/** The answer of `engine/describe`: every operation the engine serves. */
export interface EngineDescription {
  readonly operations: readonly OperationDescription[];
}

const jsonSchema = z.record(z.string(), z.unknown());

/** Parses the answer of `engine/describe`. */
export const engineDescriptionSchema: z.ZodType<EngineDescription> = z.object({
  operations: z.array(
    z.object({
      name: z.string().min(1),
      scope: scopeSchema,
      scopeCase: scopeCaseSchema.exactOptional(),
      kind: operationKindSchema,
      idempotency: idempotencyRuleSchema,
      transport: operationTransportSchema,
      answeredBy: operationResponderSchema,
      since: releaseVersionSchema,
      args: jsonSchema,
      result: jsonSchema,
    }),
  ),
});
