import { BinferenceError } from "@binference/core";
import { describe, expect, it } from "vitest";
import { agent, callTool, outcomeOf, toolTurn } from "../testing/agent-tool-fixtures.js";

const pie = {
  chartType: "pie",
  title: "Holdings",
  segments: [
    { label: "BNB", value: 3 },
    { label: "USDT", value: 1 },
  ],
};

describe("the show_chart tool", () => {
  it("has the engine show the chart in this turn's chat, and names what it showed", async () => {
    const run = callTool({ "turn/chart": { chart: pie } }, { name: "show_chart", args: pie });
    const outcome = await outcomeOf(run);
    expect(run.client.calls()).toStrictEqual([
      { op: "turn/chart", args: { agent, turn: toolTurn.turn, chart: pie } },
    ]);
    expect(outcome.shown).toStrictEqual(["Holdings (pie chart)", "- BNB: 3", "- USDT: 1"]);
    expect(outcome.text).toContain("Do not repeat its numbers.");
  });

  it("sends series with their axes, and no pie fields", async () => {
    const line = {
      chartType: "line",
      title: "Price",
      categories: ["12:00", "13:00"],
      series: [{ name: "BNB", values: [612, 615] }],
      yLabel: "USD",
    };
    const run = callTool({ "turn/chart": { chart: line } }, { name: "show_chart", args: line });
    await outcomeOf(run);
    expect(run.client.calls()[0]?.args).toStrictEqual({ agent, turn: toolTurn.turn, chart: line });
  });

  it("says what makes a chart hold together when the engine refuses it", async () => {
    const refused = new BinferenceError({ code: "protocol.bad_args", message: "Bad." });
    const outcome = await outcomeOf(
      callTool(
        { "turn/chart": refused },
        { name: "show_chart", args: { chartType: "pie", title: "x" } },
      ),
    );
    expect(outcome.isError).toBe(true);
    expect(outcome.text).toContain("a pie needs 1 to 12 segments");
  });
});
