import { type ChainRef, chainRefSchema } from "@binference/chain";
import { z } from "zod";
import { type LaunchpadView, launchpadViewSchema } from "../views/launchpad-view.schema.js";
import { readFlags, type OperationTable } from "./operation.schema.js";

/** The args of `launchpad/list`: the chain whose launchpads the engine runs. */
interface LaunchpadListArgs {
  readonly chain: ChainRef;
}

/** What `launchpad/list` answers: every launchpad the engine runs on the chain, by venue id. */
interface LaunchpadList {
  readonly items: readonly LaunchpadView[];
}

/** The launchpad read of protocol spec section 7.3. */
export interface LaunchpadOperationShapes {
  readonly "launchpad/list": { readonly args: LaunchpadListArgs; readonly result: LaunchpadList };
}

/** The launchpad operation, by name. */
export const launchpadOperations: OperationTable<LaunchpadOperationShapes> = {
  "launchpad/list": {
    ...readFlags,
    name: "launchpad/list",
    scope: "read",
    args: z.strictObject({ chain: chainRefSchema }),
    result: z.object({ items: z.array(launchpadViewSchema).max(64) }),
  },
};
