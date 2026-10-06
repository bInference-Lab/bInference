import { describe, expect, it } from "vitest";
import { protocolErrorCodes } from "../errors/protocol-error-codes.js";
import { operationNames } from "../operations/operations.js";
import { protocolVersion } from "../versions/protocol-version.js";
import { describeOperations } from "./describe-operations.js";
import { describeProtocol } from "./describe-protocol.js";
import { engineDescriptionSchema } from "./engine-description.schema.js";

type JsonObject = Readonly<Record<string, unknown>>;
type Field = readonly [path: string, schema: JsonObject];

const moneyField = /\.(?:base|price|worstPrice|perTxNative|quantity|[a-zA-Z]*Micros)$/;
const timeField = /\.[a-z][a-zA-Z]*At$/;

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function namedFields(properties: JsonObject, path: string): readonly Field[] {
  return Object.keys(properties).flatMap((name) => {
    const property = properties[name];
    const field: Field = [`${path}.${name}`, isObject(property) ? property : {}];
    return isObject(property) ? [field].concat(fieldsOf(property, field[0])) : [];
  });
}

// Every named property in a JSON Schema, with its path, through unions, arrays and records.
function fieldsOf(schema: unknown, path: string): readonly Field[] {
  if (Array.isArray(schema)) {
    return schema.flatMap((item: unknown) => fieldsOf(item, path));
  }
  if (!isObject(schema)) {
    return [];
  }
  const { properties, ...rest } = schema;
  return [
    ...(isObject(properties) ? namedFields(properties, path) : []),
    ...Object.values(rest).flatMap((value: unknown) => fieldsOf(value, path)),
  ];
}

function typeOf(field: Field): unknown {
  return field[1]["type"];
}

const schemas = describeProtocol().schemas;
const fields = Object.keys(schemas).flatMap((name) => fieldsOf(schemas[name], name));
const moneyTypes = fields.filter((field) => moneyField.test(field[0])).map(typeOf);
const timeTypes = fields.filter((field) => timeField.test(field[0])).map(typeOf);

describe("describeProtocol", () => {
  it("converts the frames, error codes, id prefixes and each operation's call and reply", () => {
    const description = describeProtocol();
    expect(description.version).toBe(protocolVersion);
    expect(Object.keys(description.schemas)).toStrictEqual([
      "frame/open",
      "frame/challenge",
      "frame/prove",
      "frame/ready",
      "frame/call",
      "frame/reply",
      "frame/fail",
      "frame/push",
      "frame/bye",
      "error/codes",
      "id/prefixes",
      ...operationNames.flatMap((name) => [`call/${name}`, `reply/${name}`]),
    ]);
    expect(description.schemas["error/codes"]?.enum).toStrictEqual([...protocolErrorCodes]);
  });

  it("describes the wire form, where optional fields are absent", () => {
    expect(schemas["frame/call"]).toMatchObject({
      type: "object",
      required: ["t", "id", "op", "args"],
      properties: { key: { type: "string", maxLength: 64 } },
    });
  });

  it("requires the key in the call of a write and carries the operation's access rules", () => {
    expect(schemas["call/limit/set"]).toMatchObject({
      required: ["t", "id", "op", "args", "key"],
      properties: { op: { const: "limit/set" } },
      scope: "confirm",
      scopeCase: { scope: "loosen", when: "looser" },
      kind: "write",
      transport: "any",
      answeredBy: "engine",
      since: "2026.10.0",
    });
    expect(schemas["call/intent/get"]?.required).toStrictEqual(["t", "id", "op", "args"]);
  });

  it("writes every amount as a decimal string and every time as whole milliseconds", () => {
    expect(moneyTypes.length).toBeGreaterThan(100);
    expect(new Set(moneyTypes)).toStrictEqual(new Set(["string"]));
    expect(timeTypes.length).toBeGreaterThan(100);
    expect(new Set(timeTypes)).toStrictEqual(new Set(["integer"]));
  });
});

describe("describeOperations", () => {
  const description = describeOperations();
  const described = new Map(description.operations.map((operation) => [operation.name, operation]));

  it("parses as the answer of engine/describe and lists every operation in order", () => {
    expect(engineDescriptionSchema.parse(description)).toStrictEqual(description);
    expect([...described.keys()]).toStrictEqual(operationNames);
  });

  it("gives each operation its rules and the JSON Schemas of its args and result", () => {
    expect(described.get("wallet/create")).toMatchObject({
      scope: "admin",
      kind: "write",
      idempotency: "key",
      transport: "ipc",
      answeredBy: "engine",
      args: {
        type: "object",
        additionalProperties: false,
        required: ["agent", "label", "ownerKey"],
      },
      result: { type: "object", required: ["wallet", "agent", "address", "label", "createdAt"] },
    });
  });

  it("leaves out the scope case of an operation without one", () => {
    expect(described.get("intent/get")).not.toHaveProperty("scopeCase");
  });
});
