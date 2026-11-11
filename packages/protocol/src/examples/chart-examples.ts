import type { ChartOperationShapes } from "../operations/chart-operations.schema.js";
import { ids, type WireExample } from "./wire-values.js";

const chart = {
  chartType: "line",
  title: "TKN price, last 4 hours",
  categories: ["12:00", "13:00", "14:00", "15:00"],
  series: [{ name: "TKN", values: [612.4, 615.1, 609.8, 618.2] }],
  yLabel: "USD",
};

/** Example calls of the operation the agent shows the owner a chart with (decision 0387). */
export const chartExamples: { readonly [N in keyof ChartOperationShapes]: WireExample } = {
  "turn/chart": { args: { agent: ids.agent, turn: ids.turn, chart }, result: { chart } },
};
