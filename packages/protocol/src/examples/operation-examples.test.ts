import { describe, expect, it } from "vitest";
import { z } from "zod";
import { operationNames, operations } from "../operations/operations.js";
import { operationExamples } from "./operation-examples.js";

describe("operation examples", () => {
  it("cover every operation", () => {
    expect(Object.keys(operationExamples)).toStrictEqual(operationNames);
  });

  it.each(operationNames)("decode the args of %s and encode them back unchanged", (name) => {
    const schema = operations[name].args;
    const { args } = operationExamples[name];
    expect(z.encode(schema, z.decode(schema, args))).toStrictEqual(args);
  });

  it.each(operationNames)("decode the result of %s and encode it back unchanged", (name) => {
    const schema = operations[name].result;
    const { result } = operationExamples[name];
    expect(z.encode(schema, z.decode(schema, result))).toStrictEqual(result);
  });
});
