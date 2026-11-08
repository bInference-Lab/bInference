import type { HelperOperationShapes } from "../operations/helper-operations.schema.js";
import { ids, type WireExample } from "./wire-values.js";

/** Example calls of the operation that tells the agent a helper's end. */
export const helperExamples: { readonly [N in keyof HelperOperationShapes]: WireExample } = {
  "helper/ended": {
    args: {
      agent: ids.agent,
      helper: ids.session,
      surface: "telegram",
      text: '[binference: your helper "BNB news" finished. Its report: no listing news today.]',
      outsideContent: true,
    },
    result: {},
  },
};
