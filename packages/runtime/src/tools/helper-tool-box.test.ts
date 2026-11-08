import { BinferenceError } from "@binference/core";
import { createManualClock } from "@binference/core/testing";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { agent, toolTurn } from "../testing/agent-tool-fixtures.js";
import { createFakeToolClient } from "../testing/fake-tool-client.js";
import { startHelperRig } from "../testing/helper-rig.js";
import { agentTools, helperToolBox } from "./agent-tools.js";
import { type AgentTool, defineTool } from "./define-tool.js";
import type { AgentToolParts } from "./tool-client.js";

function neverCalled(): never {
  throw new BinferenceError({ code: "runtime.tool_invalid", message: "Not called here." });
}

// Every tool the agent can have: the web tools, the image tool and the helper tools among them.
async function fullParts(): Promise<AgentToolParts> {
  const rig = await startHelperRig({ replies: [] });
  const clock = createManualClock(1);
  return {
    agent,
    client: createFakeToolClient({}),
    turn: toolTurn,
    web: {
      http: { open: neverCalled },
      lookup: neverCalled,
      clock,
      search: { keys: {}, xApiKey: "set" },
    },
    imageMaking: {
      jobs: { running: neverCalled, start: neverCalled },
      maker: "set",
      random: { bytes: neverCalled },
      clock,
    },
    videoMaking: {
      jobs: { running: neverCalled, start: neverCalled },
      maker: "set",
      random: { bytes: neverCalled },
      clock,
    },
    speaking: { source: { kind: "local" }, random: { bytes: neverCalled } },
    helpers: { desk: rig.desk, clock },
  };
}

// Declares a tool of the kind that says a helper may call it.
function declare(kind: "propose" | "control"): () => AgentTool {
  return () =>
    defineTool({
      name: "bad_tool",
      kind,
      description: "A tool that should never reach a helper.",
      args: z.strictObject({}),
      forHelpers: true,
      run: async () => Promise.resolve({ text: "ran", isError: false }),
    });
}

describe("the tools of a helper's turn", () => {
  it("holds only reads and machine tools, and none that proposes, asks or starts a helper", async () => {
    const parts = await fullParts();
    const kinds = new Map(agentTools(parts).map((tool) => [tool.name, tool.kind]));
    const names = helperToolBox(parts).declarations.map(({ name }) => name);
    const helperKinds = new Set(names.map((name) => kinds.get(name)));
    expect(helperKinds).toStrictEqual(new Set(["read", "machine"]));
    expect(names).toEqual(
      expect.arrayContaining(["search_web", "token_info", "notes_search", "shell", "file_write"]),
    );
    const never = ["swap", "send", "order_create", "settings_change", "ask_owner", "credentials"];
    const others = ["make_image", "show_images", "send_files", "deposit_address", "alert_create"];
    const media = ["make_video", "speak"];
    const own = ["schedule_list", "schedule_create", "helper_start", "helper_list", "helper_read"];
    expect(
      names.filter((name) => [...never, ...others, ...media, ...own].includes(name)),
    ).toStrictEqual([]);
    // The agent itself keeps every one of them.
    expect(
      [...never, ...others, ...media, ...own].filter((name) => !kinds.has(name)),
    ).toStrictEqual([]);
  });

  it("never runs a proposal a helper's model writes: the box holds no such tool", async () => {
    const box = helperToolBox(await fullParts());
    const swap = box.prepare({ id: "call_1", name: "swap", argumentsText: "{}" });
    expect(swap).toStrictEqual({ ready: false, text: "not run: there is no tool named swap" });
    const start = box.prepare({ id: "call_2", name: "helper_start", argumentsText: "{}" });
    expect(start.ready).toBe(false);
  });

  it("refuses a propose or control tool declared as one a helper may call", () => {
    expect(declare("propose")).toThrow("never a helper's");
    expect(declare("control")).toThrow("never a helper's");
  });
});
