import type { HttpOperationShapes } from "../operations/http-operations.schema.js";
import { ids, type WireExample } from "./wire-values.js";

/** Example calls of the operation of the agent's API requests (decision 0411). */
export const httpExamples: { readonly [N in keyof HttpOperationShapes]: WireExample } = {
  "http/request": {
    args: {
      agent: ids.agent,
      method: "POST",
      url: "https://api.example.com/v1/query?key={{credential:EXAMPLE_API_KEY}}",
      headers: [{ name: "Content-Type", value: "application/json" }],
      body: '{"query":"bnb volume"}',
      timeoutSeconds: 15,
    },
    result: {
      kind: "answer",
      status: 200,
      headers: [
        { name: "content-type", value: "application/json" },
        { name: "x-ratelimit-remaining", value: "59" },
      ],
      contentType: "application/json",
      bytes: 27,
      body: '{"volume":"18204.5","n":42}',
      binary: false,
      cut: false,
      durationMs: 412,
    },
  },
};
