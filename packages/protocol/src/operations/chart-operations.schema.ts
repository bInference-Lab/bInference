import { z } from "zod";
import { type ProtocolId, protocolIdSchema } from "../ids/id-prefixes.js";
import { type PortableChart, portableChartSchema } from "../views/portable-chart.schema.js";
import { type OperationTable, readFlags } from "./operation.schema.js";

/** The args of `turn/chart`: the agent, the turn that shows the owner a chart, and the chart. */
interface ChartArgs {
  readonly agent: ProtocolId<"agent">;
  readonly turn: ProtocolId<"chatTurn">;
  readonly chart: PortableChart;
}

/** The operation the agent shows the owner a chart with (decision 0387). */
export interface ChartOperationShapes {
  readonly "turn/chart": {
    readonly args: ChartArgs;
    readonly result: { readonly chart: PortableChart };
  };
}

/** The chart operation, by name. */
export const chartOperations: OperationTable<ChartOperationShapes> = {
  "turn/chart": {
    ...readFlags,
    name: "turn/chart",
    scope: "agent",
    args: z.strictObject({
      agent: protocolIdSchema("agent"),
      turn: protocolIdSchema("chatTurn"),
      chart: portableChartSchema,
    }),
    result: z.object({ chart: portableChartSchema }),
  },
};
