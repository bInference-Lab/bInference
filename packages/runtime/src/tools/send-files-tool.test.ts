import { BinferenceError } from "@binference/core";
import { describe, expect, it } from "vitest";
import { agent, callTool, outcomeOf, toolTurn } from "../testing/agent-tool-fixtures.js";

const sent = {
  files: [
    { file: "c3d4e5f607182930", name: "trades.csv", bytes: 10, path: "/w/reports/trades.csv" },
    { file: "d4e5f60718293041", name: "b c.pdf", bytes: 8, path: "/docs/b c.pdf" },
  ],
};

describe("the send_files tool", () => {
  it("has the engine send files on the machine to this turn's chat, and names what it sent", async () => {
    const paths = ["@reports/trades.csv", "file:///docs/b%20c.pdf"];
    const run = callTool(
      { "file/send": sent },
      { name: "send_files", args: { paths, caption: "The week's files." } },
    );
    const outcome = await outcomeOf(run);
    expect(run.client.calls()).toStrictEqual([
      {
        op: "file/send",
        args: {
          agent,
          turn: toolTurn.turn,
          paths: ["reports/trades.csv", "/docs/b c.pdf"],
          caption: "The week's files.",
        },
      },
    ]);
    const lines = ["trades.csv: /w/reports/trades.csv", "b c.pdf: /docs/b c.pdf"];
    expect(outcome).toMatchObject({ isError: false, shown: lines });
    expect(outcome.text.split("\n").slice(1, 3)).toStrictEqual(lines);
  });

  it("says why nothing was sent, with the next step", async () => {
    const large = new BinferenceError({ code: "file.too_large", message: "Over the limit." });
    const outcome = await outcomeOf(
      callTool(
        { "file/send": large },
        { name: "send_files", args: { paths: ["~/big.zip"], caption: "Archive." } },
      ),
    );
    expect(outcome).toMatchObject({ isError: true });
    expect(outcome.text).toContain("over 20 MiB");
    expect(outcome.text).toContain("smaller copy");
  });

  it("takes one to ten paths and a caption", () => {
    const many = Array.from({ length: 11 }, (_, index) => `${String(index)}.txt`);
    const refused = [
      { paths: [], caption: "None." },
      { paths: ["a.txt"] },
      { paths: many, caption: "Too many." },
    ].map((args) => callTool({}, { name: "send_files", args }).refused);
    expect(refused.every((text) => text?.startsWith("not run: the arguments do not match"))).toBe(
      true,
    );
  });
});
