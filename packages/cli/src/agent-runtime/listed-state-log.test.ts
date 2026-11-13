import { idSchema } from "@binference/core";
import { createMemoryLogger } from "@binference/core/testing";
import { describe, expect, it } from "vitest";
import { createListedStateLog } from "./listed-state-log.js";

const agent = idSchema("agt").parse("agt_0190f1c2-3a4b-7c5d-8e6f-000000000001");
const listing = idSchema("mls").parse("mls_0190f1c2-3a4b-7c5d-8e6f-000000000001");

describe("createListedStateLog", () => {
  it("logs each change of a listing's state with ids and reasons only, and its end as ok", () => {
    const logger = createMemoryLogger({ subsystem: "runtime" });
    const hear = createListedStateLog(logger);
    const resting = { agent, listing, state: "resting" as const, reason: "unreachable" };

    hear([resting]);
    hear([resting]);
    hear([{ ...resting, state: "off", reason: "changed", tool: "rate" }]);
    hear([]);

    expect(logger.records().map(({ event, fields }) => [event, fields])).toStrictEqual([
      ["runtime.listed_mcp", { agentId: agent, listing, state: "resting", reason: "unreachable" }],
      ["runtime.listed_mcp", { agentId: agent, listing, state: "off", reason: "changed" }],
      ["runtime.listed_mcp", { agentId: agent, listing, state: "ok" }],
      ["runtime.listed_mcp", { agentId: agent, listing, state: "ok" }],
    ]);
  });
});
