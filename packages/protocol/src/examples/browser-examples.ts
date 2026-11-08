import type { BrowserOperationShapes } from "../operations/browser-operations.schema.js";
import { ids, type WireExample } from "./wire-values.js";

/** Example calls of the operation the agent drives its browser with (decision 0401). */
export const browserExamples: { readonly [N in keyof BrowserOperationShapes]: WireExample } = {
  "browser/run": {
    args: { agent: ids.agent, request: { action: "navigate", url: "https://example.com/" } },
    result: {
      running: true,
      tab: { tab: "t1", url: "https://example.com/", title: "Example Domain" },
      snapshot: '- heading "Example Domain" [level=1] [ref=e3]\n- link "Learn more" [ref=e6]',
    },
  },
};
