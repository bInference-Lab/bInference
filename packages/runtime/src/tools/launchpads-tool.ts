import { marketTermFields, operations } from "@binference/protocol";
import { z } from "zod";
import { agentToolTexts } from "./agent-tool-texts.js";
import { type AgentTool, defineTool } from "./define-tool.js";
import { answerOrFailure, jsonOf } from "./tool-answer.js";
import type { AgentToolParts } from "./tool-client.js";

/**
 * `launchpads`, a read tool (runtime spec, section 5.1): the launchpads binference runs on a chain
 * through `launchpad/list`, each with where it takes a launch's picture and the settings it
 * declares, so a `launch_draft` names a photo or a picture link as its launchpad takes one.
 */
export function launchpadsTool({ client }: AgentToolParts): AgentTool {
  return defineTool({
    name: "launchpads",
    kind: "read",
    parallel: true,
    description: agentToolTexts.launchpads,
    args: z.strictObject({ chain: marketTermFields.chain }),
    run: async (args, { signal }) =>
      answerOrFailure("launchpads", async () => {
        const view = await client.call("launchpad/list", args, { signal });
        return { text: jsonOf(operations["launchpad/list"].result, view), isError: false };
      }),
  });
}
