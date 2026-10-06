import { BinferenceError } from "@binference/core";
import { z } from "zod";
import { type ConfigNode, readConfigTree } from "./config-tree.js";
import { isJsonObject, type JsonObject, jsonValueSchema } from "./json-value.schema.js";
import { configSchema } from "./schema/config.schema.js";

function toJsonSchema(): JsonObject {
  const schema = jsonValueSchema.parse(
    z.toJSONSchema(configSchema, { io: "input", unrepresentable: "throw" }),
  );
  if (!isJsonObject(schema)) {
    throw new BinferenceError({
      code: "config.schema_broken",
      message: "The config schema did not convert to a JSON Schema object.",
    });
  }
  return schema;
}

/** The JSON Schema of `config.json5`, as a file is written: defaults shown, nothing required twice. */
export const configJsonSchema: JsonObject = toJsonSchema();

/** The shape of `config.json5` as a tree, read once from {@link configJsonSchema}. */
export const configTree: ConfigNode = readConfigTree(configJsonSchema);
