import type { FileOperationShapes } from "../operations/file-operations.schema.js";
import { ids, type WireExample } from "./wire-values.js";

const notes = "~/.binference/workspace/plan.md";
const absolute = "/srv/binference/workspace/plan.md";

/** Example calls of the operations the agent reads and changes files with (decision 0386). */
export const fileExamples: { readonly [N in keyof FileOperationShapes]: WireExample } = {
  "file/read": {
    args: { agent: ids.agent, path: notes, offset: 1, limit: 2 },
    result: {
      kind: "text",
      path: absolute,
      text: "# Plan\nBuy on dips.",
      startLine: 1,
      endLine: 2,
      totalLines: 5,
      next: { offset: 3, cutBy: "lines" },
    },
  },
  "file/write": {
    args: { agent: ids.agent, path: "plan.md", content: "# Plan\n" },
    result: { path: absolute, changed: true, bytes: 7 },
  },
  "file/edit": {
    args: {
      agent: ids.agent,
      path: "plan.md",
      edits: [{ oldText: "Buy on dips.", newText: "Buy on dips below the 20-day average." }],
    },
    result: { path: absolute, changed: true, bytes: 62, replaced: 1 },
  },
  "file/patch": {
    args: {
      agent: ids.agent,
      input: "*** Begin Patch\n*** Add File: todo.md\n+- check the chart\n*** End Patch",
    },
    result: { files: [{ path: "/srv/binference/workspace/todo.md", change: "added" }] },
  },
};
