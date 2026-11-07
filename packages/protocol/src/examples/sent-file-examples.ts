import type { SentFileOperationShapes } from "../operations/sent-file-operations.schema.js";
import { ids, type WireExample } from "./wire-values.js";

const report = {
  file: "c3d4e5f607182930",
  name: "trades.csv",
  bytes: 11,
  path: "/srv/binference/workspace/reports/trades.csv",
};

/** Example calls of the operations the agent sends the owner files with (decision 0400). */
export const sentFileExamples: { readonly [N in keyof SentFileOperationShapes]: WireExample } = {
  "file/send": {
    args: {
      agent: ids.agent,
      turn: ids.turn,
      paths: ["reports/trades.csv"],
      caption: "This week's trades.",
    },
    result: { files: [report] },
  },
  "file/fetch": {
    args: { agent: ids.agent, file: report.file },
    result: { name: "trades.csv", bytes: 11, offset: 0, data: "ZGF0ZSxzaWRlCg==" },
  },
};
