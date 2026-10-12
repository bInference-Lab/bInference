import type { ModelTransport } from "../loop/ports.js";

/**
 * The transport of a runtime built with no model client yet: each call ends at once as a refused
 * request, so a turn ends `failed` with `turn.failed.request` and nothing else happens.
 */
export const noModelTransport: ModelTransport = {
  async *stream() {
    yield {
      type: "error",
      failure: "request",
      message: "This runtime has no model client for the agent's provider.",
    } as const;
  },
};
