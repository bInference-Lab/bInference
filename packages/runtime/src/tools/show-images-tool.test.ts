import { BinferenceError } from "@binference/core";
import { describe, expect, it } from "vitest";
import type { ToolOutcome } from "../loop/turn-records.js";
import { agent, callTool, context, outcomeOf, toolTurn } from "../testing/agent-tool-fixtures.js";
import { createFakeToolClient } from "../testing/fake-tool-client.js";
import { showImagesTool } from "./show-images-tool.js";
import type { ToolClient } from "./tool-client.js";

const made = "media/made/2026-11-07/0d9cad7b82bf8f12.png";
const answer = { images: [{ image: "a1b2c3d4e5f60718", path: made }] };
const walled = new BinferenceError({ code: "image.walled", message: "Walled off." });

// The paths each `image/show` call named, in order.
function pathsSent(calls: readonly { readonly args: unknown }[]): readonly unknown[] {
  return calls.map(({ args }) => (args as { readonly paths: unknown }).paths);
}

// A client whose first `image/show` answers and whose later ones are refused.
function refusingAfterOne(): ToolClient {
  const shows = createFakeToolClient({ "image/show": answer });
  const state = { calls: 0 };
  return {
    call: async (op, args, options) => {
      state.calls += 1;
      return state.calls === 1 ? shows.call(op, args, options) : Promise.reject(walled);
    },
  };
}

async function runOn(client: ToolClient, args: object): Promise<ToolOutcome> {
  const prepared = showImagesTool({ agent, client, turn: toolTurn }).prepare(JSON.stringify(args));
  if (!prepared.ready) {
    throw new Error(prepared.text);
  }
  return prepared.run(context);
}

describe("the show_images tool", () => {
  it("has the engine show images on the machine in this turn's chat, four to a message", async () => {
    const paths = ["@a.png", "file:///pictures/b%20c.png", "c.png", "d.png", "e.png"];
    const run = callTool(
      { "image/show": answer },
      { name: "show_images", args: { paths, caption: "Images made today." } },
    );
    const outcome = await outcomeOf(run);
    expect(run.client.calls().map(({ op }) => op)).toStrictEqual(["image/show", "image/show"]);
    expect(run.client.calls()[0]?.args).toMatchObject({
      agent,
      turn: toolTurn.turn,
      caption: "Images made today.",
    });
    expect(pathsSent(run.client.calls())).toStrictEqual([
      ["a.png", "/pictures/b c.png", "c.png", "d.png"],
      ["e.png"],
    ]);
    expect(outcome).toMatchObject({ isError: false, shown: [made, made] });
    expect(outcome.text).toContain("Do not repeat the paths");
  });

  it("says why nothing was shown when the engine refuses a file", async () => {
    const outcome = await outcomeOf(
      callTool(
        { "image/show": walled },
        { name: "show_images", args: { paths: ["/state/agent.sqlite"], caption: "Data." } },
      ),
    );
    expect(outcome).toStrictEqual({
      isError: true,
      text: "One of those files is inside binference's own folder, which is walled off; nothing was shown. Never try to reach it another way.",
    });
  });

  it("names what the owner already sees when a later message is refused", async () => {
    const paths = ["a.png", "b.png", "c.png", "d.png", "/state/x.png"];
    const outcome = await runOn(refusingAfterOne(), { paths, caption: "All of them." });
    expect(outcome).toMatchObject({ isError: true, shown: [made] });
    expect(outcome.text).toContain(made);
    expect(outcome.text).toContain("the images after these were not shown");
  });

  it("takes at least one path and a caption, and at most twelve paths", () => {
    const many = Array.from({ length: 13 }, (_, index) => `${String(index)}.png`);
    const refused = [
      { paths: [], caption: "None." },
      { paths: ["a.png"] },
      { paths: many, caption: "Too many." },
    ].map((args) => callTool({}, { name: "show_images", args }).refused);
    expect(refused.every((text) => text?.startsWith("not run: the arguments do not match"))).toBe(
      true,
    );
  });
});
