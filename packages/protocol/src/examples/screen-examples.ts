import type { ScreenOperationShapes } from "../operations/screen-operations.schema.js";
import { ids, type WireExample } from "./wire-values.js";

/** Example calls of the operation the agent looks at the owner's screen with (decision 0406). */
export const screenExamples: { readonly [N in keyof ScreenOperationShapes]: WireExample } = {
  "screen/capture": {
    args: { agent: ids.agent, display: 1 },
    result: {
      shots: [
        {
          path: "media/screen/2026-11-08/4f1c9a2e7b3d5e60.png",
          contentType: "image/png",
          bytes: 1_482_301,
          display: 1,
        },
      ],
    },
  },
};
